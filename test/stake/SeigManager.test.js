const range = require('lodash/range');
const first = require('lodash/first');
const last = require('lodash/last');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

const { padLeft, toBN } = require('web3-utils');
const { marshalString, unmarshalString } = require('../helpers/marshal');

const WTON = contract.fromArtifact('WTON');
const TON = contract.fromArtifact('TON');

const EpochHandler = contract.fromArtifact('EpochHandler');
const SubmitHandler = contract.fromArtifact('SubmitHandler');
const RootChain = contract.fromArtifact('RootChain');
const EtherToken = contract.fromArtifact('EtherToken');

const DepositManager = contract.fromArtifact('DepositManager');
const SeigManager = contract.fromArtifact('SeigManager');
const RootChainRegistry = contract.fromArtifact('RootChainRegistry');
const CustomIncrementCoinage = contract.fromArtifact('CustomIncrementCoinage');
const PowerTON = contract.fromArtifact('PowerTON');

const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN))
  .should();

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const log = (...args) => LOGTX && console.log(...args);

let o;
process.on('exit', function () {
  console.log(o);
});
const development = true;

const _TON = createCurrency('TON');
const _WTON = createCurrency('WTON');
const _WTON_TON = createCurrencyRatio(_WTON, _TON);

const e = web3.utils.toBN('1000000000'); // 1e9

const TON_UNIT = 'wei';
const WTON_UNIT = 'ray';
const WTON_TON_RATIO = _WTON_TON('1');

const [operator, tokenOwner] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const TON_INITIAL_SUPPLY = _TON('10000');
const SEIG_PER_BLOCK = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).div(100); // 100 (W)TON / block
const WITHDRAWAL_DELAY = 10;
const NUM_ROOTCHAINS = 4;

const tokenAmount = TON_INITIAL_SUPPLY.div(100); // 100 TON
const tokwnOwnerInitialBalance = tokenAmount.times(NUM_ROOTCHAINS);

const totalStakedAmount = tokwnOwnerInitialBalance; // 400 TON
const totalUnstakedAmount = TON_INITIAL_SUPPLY.minus(tokwnOwnerInitialBalance); // 9600 TON

const NRE_LENGTH = 2;

const ROUND_DURATION = time.duration.minutes(1);

class RootChainState {
  constructor (NRE_LENGTH) {
    this.currentFork = 0;
    this.lastEpoch = 0;
    this.lastBlock = 0;
    this.NRE_LENGTH = Number(NRE_LENGTH);
  }
}

describe('stake/SeigManager', function () {
  function makePos (v1, v2) { return toBN(v1).shln(128).add(toBN(v2)); }

  async function checkBalanceProm (balanceProm, expected, unit) {
    return checkBalance(await balanceProm, expected, unit);
  }

  function checkBalance (balanceBN, expected, unit) {
    const v = balanceBN.sub(toBN(expected.toFixed(unit))).abs();
    // if (v.cmp(e) > 0) {
    //   console.error(`
    //     actual   : ${balanceBN.toString().padStart(40)}
    //     expected : ${expected.toFixed(unit).padStart(40)}
    //     diff     : ${v.toString().padStart(40)}
    //     e        : ${e.toString().padStart(40)}

    //   `);
    // }
    v.should.be.bignumber.lte(e);
  }

  /**
   *
   * @param {*} rootchain
   * @param {RootChainState} rootchainState
   */
  async function submitDummyNRE (rootchain, rootchainState) {
    const pos1 = makePos(rootchainState.currentFork, rootchainState.lastEpoch + 1);
    const pos2 = makePos(rootchainState.lastBlock + 1, rootchainState.lastBlock + rootchainState.NRE_LENGTH);

    rootchainState.lastEpoch += 2; // skip ORE
    rootchainState.lastBlock += rootchainState.NRE_LENGTH;

    const COST_NRB = await rootchain.COST_NRB();

    return rootchain.submitNRE(
      pos1,
      pos2,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
      { value: COST_NRB },
    );
  }

  async function submitDummyNREs (rootchain, rootchainState, n) {
    for (const _ of range(n)) {
      await time.increase(time.duration.seconds(1));
      await submitDummyNRE(rootchain, rootchainState);
    }
  }

  // deploy contract and instances
  beforeEach(async function () {
    this.ton = await TON.new();
    this.wton = await WTON.new(this.ton.address);

    this.etherToken = await EtherToken.new(true, this.ton.address, true);

    const epochHandler = await EpochHandler.new();
    const submitHandler = await SubmitHandler.new(epochHandler.address);

    this.rootchains = await Promise.all(range(NUM_ROOTCHAINS).map(_ => RootChain.new(
      epochHandler.address,
      submitHandler.address,
      this.etherToken.address,
      development,
      NRE_LENGTH,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    )));

    // root chain state in local
    this.rootchainState = {};
    for (const rootchain of this.rootchains) {
      this.rootchainState[rootchain.address] = new RootChainState(NRE_LENGTH);
    }

    this.registry = await RootChainRegistry.new();

    this.depositManager = await DepositManager.new(
      this.wton.address,
      this.registry.address,
      WITHDRAWAL_DELAY,
    );

    this.seigManager = await SeigManager.new(
      this.ton.address,
      this.wton.address,
      this.registry.address,
      this.depositManager.address,
      SEIG_PER_BLOCK.toFixed(WTON_UNIT),
    );

    this.powerton = await PowerTON.new(
      this.seigManager.address,
      this.wton.address,
      ROUND_DURATION,
    );

    await this.powerton.init();

    await this.seigManager.setPowerTON(this.powerton.address);
    await this.powerton.start();

    // add minter roles
    await this.wton.addMinter(this.seigManager.address);
    await this.ton.addMinter(this.wton.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.wton,
    ].map(contract => contract.setSeigManager(this.seigManager.address)));
    await Promise.all(this.rootchains.map(rootchain => rootchain.setSeigManager(this.seigManager.address)));

    // register root chain and deploy coinage
    await Promise.all(this.rootchains.map(rootchain => this.registry.registerAndDeployCoinage(rootchain.address, this.seigManager.address)));

    // mint TON to accounts
    await this.ton.mint(defaultSender, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));
    await this.ton.approve(this.wton.address, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));

    // load tot token and coinage tokens
    this.tot = await CustomIncrementCoinage.at(await this.seigManager.tot());
    const coinageAddrs = await Promise.all(
      this.rootchains.map(rootchain => this.seigManager.coinages(rootchain.address)),
    );

    this.coinages = [];
    this.coinagesByRootChain = {};
    for (const addr of coinageAddrs) {
      const i = coinageAddrs.findIndex(a => a === addr);
      this.coinages[i] = await CustomIncrementCoinage.at(addr);
      this.coinagesByRootChain[this.rootchains[i].address] = this.coinages[i];
    }

    // contract-call wrapper functions
    this._deposit = (from, to, amount) => this.depositManager.deposit(to, amount, { from });
    this._commit = (rootchain) => submitDummyNRE(rootchain, this.rootchainState[rootchain.address]);
    this._multiCommit = (rootchain, n) => submitDummyNREs(rootchain, this.rootchainState[rootchain.address], n);
  });

  describe('when the token owner is the only depositor of each root chain', function () {
    beforeEach(async function () {
      await this.wton.swapFromTONAndTransfer(tokenOwner, tokwnOwnerInitialBalance.toFixed(TON_UNIT));
      await this.wton.approve(this.depositManager.address, tokwnOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });
    });

    describe('when the token owner equally deposits WTON to all root chains', function () {
      beforeEach(async function () {
        this.receipts = await Promise.all(this.rootchains.map(
          rootchain => this._deposit(tokenOwner, rootchain.address, tokenAmount.toFixed(WTON_UNIT)),
        ));
      });

      afterEach(function () {
        delete this.receipts;
      });

      it('should emit Deposited event', function () {
        this.receipts.forEach(({ logs }, i) => {
          const rootchain = this.rootchains[i];
          expectEvent.inLogs(logs, 'Deposited', {
            rootchain: rootchain.address,
            depositor: tokenOwner,
            amount: tokenAmount.toFixed(WTON_UNIT),
          });
        });
      });

      it('WTON balance of the token owner must be zero', async function () {
        expect(await this.wton.balanceOf(tokenOwner)).to.be.bignumber.equal('0');
      });

      it('deposit manager should have deposited WTON tokens', async function () {
        expect(await this.wton.balanceOf(this.depositManager.address)).to.be.bignumber.equal(tokenAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT));
      });

      it('coinage balance of the tokwn owner must be increased by deposited WTON amount', async function () {
        for (const coinage of this.coinages) {
          expect(await coinage.balanceOf(tokenOwner)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
        }
      });

      // TODO: test withdrawal before commit
      // it('should withdraw before commit', async function () {

      // });

      it('tot balance of root chain must be increased by deposited WTON amount', async function () {
        for (const rootchain of this.rootchains) {
          expect(await this.tot.balanceOf(rootchain.address)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
        }
      });

      // multiple root chains test
      for (const _i in range(NUM_ROOTCHAINS)) {
        const i = Number(_i);
        const indices = range(0, i + 1);
        const c = indices.map(i => `${i}-th`).join(', ');

        describe(`when ${c} root chains commits first ORE each`, function () {
          beforeEach(async function () {
            this.previousSeigBlock = await this.seigManager.lastSeigBlock();

            this.totBalancesAtCommit = {}; // track tot balance when root chain is comitted
            this.accSeig = _WTON('0');
            this.seigs = [];

            o = '';

            for (const i of indices) {
              const rootchain = this.rootchains[i];

              const sb0 = await this.seigManager.lastSeigBlock();
              const prevTotTotalSupply = await this.tot.totalSupply();

              const prevBalance = await this.tot.balanceOf(rootchain.address);

              await time.advanceBlock();
              await time.advanceBlock();
              await time.advanceBlock();
              const { tx } = await this._commit(rootchain);

              const sb1 = await this.seigManager.lastSeigBlock();
              const curTotTotalSupply = await this.tot.totalSupply();

              const curBalance = await this.tot.balanceOf(rootchain.address);

              this.totBalancesAtCommit[rootchain.address] = curBalance;

              const {
                args: {
                  totalStakedAmount: _totalStakedAmount,
                  totalSupplyOfWTON,
                  prevTotalSupply,
                  nextTotalSupply,
                },
              } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

              const { args: { totalSeig, stakedSeig, unstakedSeig, powertonSeig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

              const { args: { previous, current } } = await expectEvent.inTransaction(tx, this.tot, 'FactorSet');

              const seig = _WTON(stakedSeig, WTON_UNIT);

              checkBalance(curTotTotalSupply.sub(prevTotTotalSupply), seig, WTON_UNIT);

              this.seigs.push(seig);
              this.accSeig = this.accSeig.plus(seig);

              // test log....s
              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const accSeig = this.accSeig;

              o += `\n\n\n
    ${'-'.repeat(40)}
    ${i}-th root chain first commit
    ${'-'.repeat(40)}

    totalStakedAmount     : ${_WTON(_totalStakedAmount, 'ray').toString().padStart(15)}
    totalSupplyOfWTON     : ${_WTON(totalSupplyOfWTON, 'ray').toString().padStart(15)}
    prevTotalSupply       : ${_WTON(prevTotalSupply, 'ray').toString().padStart(15)}
    nextTotalSupply       : ${_WTON(nextTotalSupply, 'ray').toString().padStart(15)}

    tot.totalSupply       : ${_WTON(await this.tot.totalSupply(), 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    previous factor       : ${_WTON(previous, 'ray').toString().padStart(15)}
    current factor        : ${_WTON(current, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    prevBalance           : ${_WTON(prevBalance, 'ray').toString().padStart(15)}
    curBalance            : ${_WTON(curBalance, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    previous seig block : ${sb0}
    current seig block  : ${sb1}
    numBlocks           : ${sb1.sub(sb0)}

    seigPerBlock        : ${_WTON(await this.seigManager.seigPerBlock(), 'ray').toString().padStart(15)}
    totalSeig           : ${_WTON(totalSeig, 'ray').toString().padStart(15)}
    stakedSeig          : ${_WTON(stakedSeig, 'ray').toString().padStart(15)}
    unstakedSeig        : ${_WTON(unstakedSeig, 'ray').toString().padStart(15)}
    powertonSeig        : ${_WTON(powertonSeig || 0, 'ray').toString().padStart(15)}

    ${'-'.repeat(40)}

    this.seigs          : ${this.seigs.toString().padStart(15)}
    this.accSeig        : ${this.accSeig.toString().padStart(15)}
    accSeigAtCommit     : ${accSeigAtCommit.toString().padStart(15)}
    accSeig             : ${accSeig.toString().padStart(15)}

    ${'='.repeat(40)}
    `;
            }

            this.currentSeigBlock = await this.seigManager.lastSeigBlock();
          });

          for (const _i in indices) {
            const i = Number(_i);
            it(`${i}-th root chain: check amount of total supply, balance, staked amount, uncomitted amount`, async function () {
              const rootchain = this.rootchains[i];

              const accSeigAtCommit = this.seigs.slice(0, i + 1).reduce((a, b) => a.plus(b));
              const balnceAtCommit = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeigAtCommit.div(NUM_ROOTCHAINS));

              const accSeig = this.accSeig;
              const balanceAtCurrent = tokenAmount.times(WTON_TON_RATIO)
                .plus(accSeig.div(NUM_ROOTCHAINS));

              // tot balance of a root chain
              checkBalance(
                this.totBalancesAtCommit[rootchain.address],
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage total supply
              checkBalance(
                await this.coinagesByRootChain[rootchain.address].totalSupply(),
                balnceAtCommit,
                WTON_UNIT,
              );

              // coinage balance of the tokwn owner
              checkBalance(
                await this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner),
                balnceAtCommit,
                WTON_UNIT,
              );

              // staked amount of the token owner
              checkBalance(
                await this.seigManager.stakeOf(rootchain.address, tokenOwner),
                balnceAtCommit,
                WTON_UNIT,
              );

              // uncomitted amount of the tokwn owner
              checkBalance(
                await this.seigManager.uncomittedStakeOf(rootchain.address, tokenOwner),
                balanceAtCurrent.minus(balnceAtCommit),
                WTON_UNIT,
              );
            });

            it(`${i}-th root chain: the tokwn owner should claim staked amount`, async function () {
              const rootchain = this.rootchains[i];
              const coinage = this.coinagesByRootChain[rootchain.address];

              const precomitted = toBN(
                (
                  this.seigs.slice(i + 1).length > 0
                    ? this.seigs.slice(i + 1).reduce((a, b) => a.plus(b)).div(NUM_ROOTCHAINS)
                    : _WTON('0')
                ).toFixed(WTON_UNIT),
              );
              const amount = await this.seigManager.stakeOf(rootchain.address, tokenOwner);
              const additionalTotBurnAmount = await this.seigManager.additionalTotBurnAmount(rootchain.address, tokenOwner, amount);

              // console.log(`
              // amount                     ${amount.toString(10).padStart(30)}
              // precomitted                ${precomitted.toString(10).padStart(30)}
              // additionalTotBurnAmount    ${additionalTotBurnAmount.toString(10).padStart(30)}
              // `);

              const prevWTONBalance = await this.wton.balanceOf(tokenOwner);
              const prevCoinageTotalSupply = await coinage.totalSupply();
              const prevCoinageBalance = await coinage.balanceOf(tokenOwner);
              const prevTotTotalSupply = await this.tot.totalSupply();
              const prevTotBalance = await this.tot.balanceOf(rootchain.address);

              // 1. make a withdrawal request
              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');

              const tx = await this.depositManager.requestWithdrawal(rootchain.address, amount, { from: tokenOwner });

              expectEvent.inLogs(
                tx.logs,
                'WithdrawalRequested',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner,
                  amount: amount,
                },
              );

              const { args: { coinageBurnAmount, totBurnAmount } } = await expectEvent.inTransaction(tx.tx, this.seigManager, 'UnstakeLog');

              // console.log('coinageBurnAmount  ', coinageBurnAmount.toString(10).padStart(35));
              // console.log('totBurnAmount      ', totBurnAmount.toString(10).padStart(35));
              // console.log('diff               ', toBN(totBurnAmount).sub(toBN(coinageBurnAmount)).toString(10).padStart(35));

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal(amount);
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');

              // 2. process the request
              await expectRevert(this.depositManager.processRequest(rootchain.address, false, { from: tokenOwner }), 'DepositManager: wait for withdrawal delay');

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              expectEvent(
                await this.depositManager.processRequest(rootchain.address, false, { from: tokenOwner }),
                'WithdrawalProcessed',
                {
                  rootchain: rootchain.address,
                  depositor: tokenOwner,
                  amount: amount,
                },
              );

              expect(await this.depositManager.pendingUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal('0');
              expect(await this.depositManager.accUnstaked(rootchain.address, tokenOwner)).to.be.bignumber.equal(amount);

              const curWTONBalance = await this.wton.balanceOf(tokenOwner);
              const curCoinageTotalSupply = await coinage.totalSupply();
              const curCoinageBalance = await coinage.balanceOf(tokenOwner);
              const curTotTotalSupply = await this.tot.totalSupply();
              const curTotBalance = await this.tot.balanceOf(rootchain.address);

              // 3. check tokens status
              expect(curWTONBalance.sub(prevWTONBalance))
                .to.be.bignumber.equal(amount);

              expect(curCoinageTotalSupply.sub(prevCoinageTotalSupply))
                .to.be.bignumber.equal(amount.neg());

              expect(curCoinageBalance.sub(prevCoinageBalance))
                .to.be.bignumber.equal(amount.neg());

              checkBalance(
                prevTotTotalSupply.sub(curTotTotalSupply),
                _WTON(amount.add(precomitted), WTON_UNIT),
                WTON_UNIT,
              );

              checkBalance(
                prevTotBalance.sub(curTotBalance),
                _WTON(amount.add(precomitted), WTON_UNIT),
                WTON_UNIT,
              );
            });
          }
        });
      }

      describe('when 0-th root chain commits 10 times', function () {
        const i = 0;
        const n = 10;

        beforeEach(async function () {
          this.accSeig = _WTON('0');

          this.seigBlocks = [];
          this.totTotalSupplies = [];

          for (const _ of range(n)) {
            this.seigBlocks.push(await this.seigManager.lastSeigBlock());
            this.totTotalSupplies.push(await this.tot.totalSupply());
            await this._commit(this.rootchains[i]);
          }
          this.seigBlocks.push(await this.seigManager.lastSeigBlock());
          this.totTotalSupplies.push(await this.tot.totalSupply());

          this.seigs = [];
          this.accSeigs = [];

          for (let i = 1; i < this.seigBlocks.length; i++) {
            const seig = _WTON(this.totTotalSupplies[i].sub(this.totTotalSupplies[i - 1]), WTON_UNIT);

            this.seigs.push(seig);
            this.accSeig = this.accSeig.plus(seig);
            this.accSeigs.push(this.accSeig);
          }
        });

        it('should mint correct seigniorages for each commit', async function () {
          for (const j of range(this.seigBlocks.length - 1)) { // for j-th commit
            const nBlocks = this.seigBlocks[j + 1].sub(this.seigBlocks[j]);
            const accSeigBeforeCommit = this.accSeigs[j].minus(this.seigs[j]);

            const totalStaked = tokenAmount.times(WTON_TON_RATIO)
              .times(NUM_ROOTCHAINS)
              .plus(accSeigBeforeCommit);
            const totTotalSupplyBeforeCommit = TON_INITIAL_SUPPLY.times(WTON_TON_RATIO)
              .plus(accSeigBeforeCommit);

            const expectedSeig = SEIG_PER_BLOCK
              .times(nBlocks)
              .times(totalStaked)
              .div(totTotalSupplyBeforeCommit);

            // console.log(`
            // ${j}-th commit
            // this.accSeigs[j]              ${this.accSeigs[j].toString(10).padStart(40)}
            // this.seigs[j]                 ${this.seigs[j].toString(10).padStart(40)}

            // nBlocks                       ${nBlocks.toString(10).padStart(40)}
            // accSeigBeforeCommit           ${accSeigBeforeCommit.toString().padStart(40)}
            // totalStaked:                  ${totalStaked.toString().padStart(40)}
            // totTotalSupplyBeforeCommit:   ${totTotalSupplyBeforeCommit.toString().padStart(40)}
            // expectedSeig:                 ${expectedSeig.toString().padStart(40)}
            // this.seigs[j]:                ${this.seigs[j].toString().padStart(40)}
            // ${'-'.repeat(50)}
            // `);

            checkBalance(
              toBN(this.seigs[j].toFixed(WTON_UNIT)),
              expectedSeig,
              WTON_UNIT,
            );
          }
        });

        it(`${i}-th root chain: check amount of total supply, balance, staked amount`, async function () {
          const rootchain = this.rootchains[i];

          const expected = tokenAmount.times(WTON_TON_RATIO).plus(this.accSeig.div(4)); // actually not .div(4)...

          // tot total supply is checked in previous test.

          // coinage total supply
          checkBalance(
            await this.coinagesByRootChain[rootchain.address].totalSupply(),
            expected,
            WTON_UNIT,
          );

          // coinage balance of the tokwn owner
          checkBalance(
            await this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner),
            expected,
            WTON_UNIT,
          );

          // staked amount of the token owner
          checkBalance(
            await this.seigManager.stakeOf(rootchain.address, tokenOwner),
            expected,
            WTON_UNIT,
          );
        });

        describe('when the token holder tries to withdraw all stakes', function () {
          let wtonAmount;

          beforeEach(async function () {
            wtonAmount = await this.seigManager.stakeOf(this.rootchains[i].address, tokenOwner);
          });

          it('should withdraw', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner });

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner });

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(wtonAmount);
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(wtonAmount);
          });

          describe('after the token holder withdraw all stakes in TON', function () {
            let tonAmount;

            beforeEach(async function () {
              await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner });

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              const tonBalance0 = await this.ton.balanceOf(tokenOwner);
              await this.depositManager.processRequest(this.rootchains[i].address, true, { from: tokenOwner });
              const tonBalance1 = await this.ton.balanceOf(tokenOwner);

              tonAmount = tonBalance1.sub(tonBalance0);
            });

            it('the root chain can commit next epochs', async function () {
              await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
            });

            it('the token holder can deposit again', async function () {
              const data = marshalString(
                [this.depositManager.address, this.rootchains[i].address]
                  .map(unmarshalString)
                  .map(str => padLeft(str, 64))
                  .join(''),
              );

              await this.ton.approveAndCall(
                this.wton.address,
                tonAmount,
                data,
                { from: tokenOwner },
              );
            });

            describe('after the root chain commits 10 epochs', function () {
              beforeEach(async function () {
                await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
              });

              it('the token holder can deposit again', async function () {
                const data = marshalString(
                  [this.depositManager.address, this.rootchains[i].address]
                    .map(unmarshalString)
                    .map(str => padLeft(str, 64))
                    .join(''),
                );

                await this.ton.approveAndCall(
                  this.wton.address,
                  tonAmount,
                  data,
                  { from: tokenOwner },
                );
              });
            });
          });

          describe('after the token holder withdraw all stakes in WTON', function () {
            beforeEach(async function () {
              await this.depositManager.requestWithdrawal(this.rootchains[i].address, wtonAmount, { from: tokenOwner });

              await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

              await this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner });
            });

            it('the root chain can commit next epochs', async function () {
              await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
            });

            it('the token holder can deposit again', async function () {
              await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner });
              await this._deposit(tokenOwner, this.rootchains[i].address, wtonAmount);
            });

            describe('after the root chain commits 10 epochs', function () {
              beforeEach(async function () {
                await Promise.all(range(10).map(_ => this._commit(this.rootchains[i])));
              });

              it('the token holder can deposit again', async function () {
                await this.wton.approve(this.depositManager.address, wtonAmount, { from: tokenOwner });
                await this._deposit(tokenOwner, this.rootchains[i].address, wtonAmount);
              });
            });
          });
        });

        describe('when the token holder tries to withdraw 10% of staked WTON 10 times', function () {
          const n = 10;
          const nBN = toBN(n);
          let amount;

          beforeEach(async function () {
            amount = (await this.seigManager.stakeOf(this.rootchains[i].address, tokenOwner)).div(nBN);
          });

          it('should withdraw', async function () {
            const tokenOwnerWtonBalance0 = await this.wton.balanceOf(tokenOwner);
            const depositManagerWtonBalance0 = await this.wton.balanceOf(this.depositManager.address);

            await Promise.all(range(n).map(_ => this.depositManager.requestWithdrawal(this.rootchains[i].address, amount, { from: tokenOwner })));

            await Promise.all(range(WITHDRAWAL_DELAY + 1).map(_ => time.advanceBlock()));

            await Promise.all(range(n).map(_ => this.depositManager.processRequest(this.rootchains[i].address, false, { from: tokenOwner })));

            const tokenOwnerWtonBalance1 = await this.wton.balanceOf(tokenOwner);
            const depositManagerWtonBalance1 = await this.wton.balanceOf(this.depositManager.address);

            expect(depositManagerWtonBalance1.sub(depositManagerWtonBalance0).neg()).to.be.bignumber.equal(amount.mul(nBN));
            expect(tokenOwnerWtonBalance1.sub(tokenOwnerWtonBalance0)).to.be.bignumber.equal(amount.mul(nBN));
          });
        });

        describe('after seig manager is paused', function () {
          beforeEach(async function () {
            await this.seigManager.pause();
          });

          it('commit should not be reverted', async function () {
            await this._commit(this.rootchains[i]);
          });

          it('seigniorage must not be given', async function () {
            const totTotalSupply1 = await this.tot.totalSupply();
            await this._commit(this.rootchains[i]);
            const totTotalSupply2 = await this.tot.totalSupply();

            expect(totTotalSupply2).to.be.bignumber.equal(totTotalSupply1);
          });

          describe('after seig manager is unpaused', function () {
            beforeEach(async function () {
              await this.seigManager.unpause();
            });

            it('commit should not be reverted', async function () {
              await this._commit(this.rootchains[i]);
            });

            // TODO: check seig amount
            it('seigniorage must be given', async function () {
              const totTotalSupply1 = await this.tot.totalSupply();
              await this._commit(this.rootchains[i]);
              const totTotalSupply2 = await this.tot.totalSupply();

              expect(totTotalSupply2).to.be.bignumber.gt(totTotalSupply1);
            });
          });
        });
      });

      // describe('when 0-th root chain changes commission rate', function () {
      describe('when 0-th root chain changes commission rate', function () {
        const i = 0;
        const n = 1;

        function behaveWithCommissionRate (commissionRate) {
          const commissionPercent = commissionRate.toNumber() * 100;
          describe(`when 0-th root chain has commission rate of ${commissionPercent}%`, function () {
            it(`the root chain can commit next ${n} epochs`, async function () {
              await this._multiCommit(this.rootchains[i], n);
            });

            beforeEach(async function () {
              await this.seigManager.setCommissionRate(this.rootchains[i].address, commissionRate.toFixed(WTON_UNIT));
            });

            describe('when the root chain commits', async function () {
              let beforeCoinageTotalSupply;
              let afterCoinageTotalSupply;

              let beforeOperatorStake;
              let afterOperatorStake;

              beforeEach(async function () {
                beforeCoinageTotalSupply = await this.coinages[i].totalSupply();
                beforeOperatorStake = await this.seigManager.stakeOf(this.rootchains[i].address, defaultSender);

                console.log('beforeOperatorStake', beforeOperatorStake.toString(10));

                await this._multiCommit(this.rootchains[i], n);

                afterCoinageTotalSupply = await this.coinages[i].totalSupply();
                afterOperatorStake = await this.seigManager.stakeOf(this.rootchains[i].address, defaultSender);
              });

              it(`operator should receive ${commissionPercent}% of seigniorages`, async function () {
                const seigs = afterCoinageTotalSupply.sub(beforeCoinageTotalSupply);
                const operatorSeigs = afterOperatorStake.sub(beforeOperatorStake);

                console.log('seigs', seigs.toString(10));
                console.log('operatorSeigs', operatorSeigs.toString(10));
                console.log('commissionRate', commissionRate.toFixed(WTON_UNIT));

                expect(seigs).to.be.bignumber.gt('0');
                expect(operatorSeigs).to.be.bignumber.equal(_WTON(seigs, WTON_UNIT).times(commissionRate).toFixed(WTON_UNIT));
              });
            });
          });
        }

        behaveWithCommissionRate(_WTON('0.5'));

        behaveWithCommissionRate(_WTON('0.0'));

        behaveWithCommissionRate(_WTON('1.0'));
      });
    });
  });
});
