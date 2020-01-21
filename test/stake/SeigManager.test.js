const range = require('lodash/range');

const { createCurrency, createCurrencyRatio } = require('@makerdao/currency');
const {
  defaultSender, accounts, contract, web3,
} = require('@openzeppelin/test-environment');
const {
  BN, constants, expectEvent, expectRevert, time, ether,
} = require('@openzeppelin/test-helpers');

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

const chai = require('chai');
const { expect } = chai;
chai.use(require('chai-bn')(BN))
  .should();

const toBN = web3.utils.toBN;
const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const development = true;

const _TON = createCurrency('TON');
const _WTON = createCurrency('WTON');
const _WTON_TON = createCurrencyRatio(_WTON, _TON);

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

class RootChainState {
  constructor (NRE_LENGTH) {
    this.currentFork = 0;
    this.lastEpoch = 0;
    this.lastBlock = 0;
    this.NRE_LENGTH = Number(NRE_LENGTH);
  }
}

const e = web3.utils.toBN('1000000000'); // 1e9

describe.only('stake/SeigManager', function () {
  function makePos (v1, v2) { return toBN(v1).shln(128).add(toBN(v2)); }

  async function checkBalanceProm (balanceProm, expected, unit) {
    return checkBalance(await balanceProm, expected, unit);
  }

  function checkBalance (balanceBN, expected, unit) {
    const v = balanceBN.sub(toBN(expected.toFixed(unit))).abs();
    if (v.cmp(e) > 0) {
      console.error(`
        actual   : ${balanceBN.toString().padStart(40)}
        expected : ${expected.toFixed(unit).padStart(40)}
        diff     : ${v.toString().padStart(40)}
        e        : ${e.toString().padStart(40)}

      `);
    }
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

    // add WSTON minter role to seig manager
    await this.wton.addMinter(this.seigManager.address);

    // set seig manager to contracts
    await Promise.all([
      this.depositManager,
      this.ton,
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
  });

  // local variables
  beforeEach(async function () {
    // load seig block for each root chain
    this.previousSeigBlocks = {};
    this.currentSeigBlocks = {};
    for (const rootchain of this.rootchains) {
      this.previousSeigBlocks[rootchain.address] = await this.seigManager.lastSeigBlock();
      this.currentSeigBlocks[rootchain.address] = this.previousSeigBlocks[rootchain.address];
    }

    // accumulated seigniorages
    this.accSeig = _WTON('0');
  });

  describe('when the token owner is the only depositor of each root chain', function () {
    beforeEach(async function () {
      await this.wton.swapFromTONAndTransfer(tokenOwner, tokwnOwnerInitialBalance.toFixed(TON_UNIT));
      await this.wton.approve(this.depositManager.address, tokwnOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });
    });

    describe('when the token owner deposits WTON to all root chains', function () {
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

      it('tot balance of root chain must be increased by deposited WTON amount', async function () {
        for (const rootchain of this.rootchains) {
          expect(await this.tot.balanceOf(rootchain.address)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
        }
      });

      for (const i in range(NUM_ROOTCHAINS)) {
        const indices = range(0, Number(i) + 1);
        const c = indices.map(i => `${i}-th`).join(', ');

        describe.only(`when ${c} root chains commits first ORE each`, function () {
          beforeEach(async function () {
            this.previousSeigBlock = await this.seigManager.lastSeigBlock();
            this.previousTotTotalSupply = await this.tot.totalSupply();

            this.currentTotBalances = {}; // track tot balance when root chain is comitted

            for (const i of indices) {
              const rootchain = this.rootchains[i];

              const sb0 = await this.seigManager.lastSeigBlock();

              const prevBalance = await this.tot.balanceOf(rootchain.address);

              this.previousSeigBlocks[rootchain.address] = await this.seigManager.lastSeigBlock();

              await time.advanceBlock();
              await time.advanceBlock();
              await time.advanceBlock();
              const { tx } = await this._commit(rootchain);

              const sb1 = await this.seigManager.lastSeigBlock();

              this.currentTotBalances[rootchain.address] = await this.tot.balanceOf(rootchain.address);

              this.currentSeigBlocks[rootchain.address] = await this.seigManager.lastSeigBlock();

              const { args: { totalStakedAmount, totalSupplyOfWTON, prevTotalSupply, nextTotalSupply } } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

              const { args: { totalSeig, stakedSeig, unstakedSeig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

              const { args: { previous, current } } = await expectEvent.inTransaction(tx, this.tot, 'FactorSet');

              console.log(`
              ${i}-th  root chain commited

              totalStakedAmount     : ${_WTON(totalStakedAmount, 'ray').toString().padStart(15)}
              totalSupplyOfWTON     : ${_WTON(totalSupplyOfWTON, 'ray').toString().padStart(15)}
              prevTotalSupply       : ${_WTON(prevTotalSupply, 'ray').toString().padStart(15)}
              nextTotalSupply       : ${_WTON(nextTotalSupply, 'ray').toString().padStart(15)}

              tot.totalSupply       : ${_WTON(await this.tot.totalSupply(), 'ray').toString().padStart(15)}

              ${'-'.repeat(40)}

              previous factor       : ${_WTON(previous, 'ray').toString().padStart(15)}
              current factor        : ${_WTON(current, 'ray').toString().padStart(15)}

              ${'-'.repeat(40)}

              prevBalance           : ${_WTON(prevBalance, 'ray').toString().padStart(15)}
              curBalance            : ${_WTON(this.currentTotBalances[rootchain.address], 'ray').toString().padStart(15)}

              ${'-'.repeat(40)}

              previous seig block : ${sb0}
              current seig block  : ${sb1}
              numBlocks           : ${sb1.sub(sb0)}

              seigPerBlock        : ${_WTON(await this.seigManager.seigPerBlock(), 'ray').toString().padStart(15)}
              totalSeig           : ${_WTON(totalSeig, 'ray').toString().padStart(15)}
              stakedSeig          : ${_WTON(stakedSeig, 'ray').toString().padStart(15)}
              unstakedSeig        : ${_WTON(unstakedSeig, 'ray').toString().padStart(15)}

              ${'='.repeat(40)}
              ${'='.repeat(40)}
              `);
            }

            this.currentSeigBlock = await this.seigManager.lastSeigBlock();
            this.currentTotTotalSupply = await this.tot.totalSupply();
          });

          afterEach(async function () {
            delete this.currentTotBalances;

            delete this.previousSeigBlock;
            delete this.currentSeigBlock;

            delete this.previousTotTotalSupply;
            delete this.currentTotTotalSupply;
          });

          for (const i in indices) {
            it(`${i}-th root chain: tot balance of root chain and coinage balance of token owner should be increased`, async function () {
              const rootchain = this.rootchains[Number(i)];

              const nBlocks = this.currentSeigBlocks[rootchain.address].sub(this.previousSeigBlocks[rootchain.address]).toNumber();

              const totalSeig = SEIG_PER_BLOCK.times(nBlocks)
                .times(totalStakedAmount.times(WTON_TON_RATIO).plus(this.accSeig))
                .div(TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).plus(this.accSeig));

              this.accSeig = this.accSeig.plus(totalSeig);

              console.log(`
              totalSeig     : ${totalSeig.toString().padStart(15)}
              this.accSeig  : ${this.accSeig.toString().padStart(15)}
              `);

              const expectedBalance = tokenAmount.times(WTON_TON_RATIO)
                .plus(this.accSeig.div(NUM_ROOTCHAINS));

              checkBalance(
                this.currentTotBalances[rootchain.address],
                expectedBalance,
                WTON_UNIT,
              );

              await checkBalanceProm(
                this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner),
                expectedBalance,
                WTON_UNIT,
              );
            });
          }

          describe.only(`when ${c} root chains commits second ORE each`, function () {
            // beforeEach(async function () {
            //   this.previousSeigBlock = await this.seigManager.lastSeigBlock();
            //   this.previousTotTotalSupply = await this.tot.totalSupply();

            //   this.currentTotBalances = {}; // track tot balance when root chain is comitted

            //   for (const i of indices) {
            //     const rootchain = this.rootchains[i];

            //     const sb0 = await this.seigManager.lastSeigBlock();

            //     const prevBalance = await this.tot.balanceOf(rootchain.address);

            //     this.previousSeigBlocks[rootchain.address] = await this.seigManager.lastSeigBlock();

            //     await time.advanceBlock();
            //     await time.advanceBlock();
            //     await time.advanceBlock();
            //     const { tx } = await this._commit(rootchain);

            //     const sb1 = await this.seigManager.lastSeigBlock();

            //     this.currentTotBalances[rootchain.address] = await this.tot.balanceOf(rootchain.address);

            //     this.currentSeigBlocks[rootchain.address] = await this.seigManager.lastSeigBlock();

            //     const { args: { totalStakedAmount, totalSupplyOfWTON, prevTotalSupply, nextTotalSupply } } = await expectEvent.inTransaction(tx, this.seigManager, 'CommitLog1');

            //     const { args: { totalSeig, stakedSeig, unstakedSeig } } = await expectEvent.inTransaction(tx, this.seigManager, 'SeigGiven');

            //     const { args: { previous, current } } = await expectEvent.inTransaction(tx, this.tot, 'FactorSet');

            //     console.log(`
            //     ${i}-th  root chain commited

            //     totalStakedAmount     : ${_WTON(totalStakedAmount, 'ray').toString().padStart(15)}
            //     totalSupplyOfWTON     : ${_WTON(totalSupplyOfWTON, 'ray').toString().padStart(15)}
            //     prevTotalSupply       : ${_WTON(prevTotalSupply, 'ray').toString().padStart(15)}
            //     nextTotalSupply       : ${_WTON(nextTotalSupply, 'ray').toString().padStart(15)}

            //     tot.totalSupply       : ${_WTON(await this.tot.totalSupply(), 'ray').toString().padStart(15)}

            //     ${'-'.repeat(40)}

            //     previous factor       : ${_WTON(previous, 'ray').toString().padStart(15)}
            //     current factor        : ${_WTON(current, 'ray').toString().padStart(15)}

            //     ${'-'.repeat(40)}

            //     prevBalance           : ${_WTON(prevBalance, 'ray').toString().padStart(15)}
            //     curBalance            : ${_WTON(this.currentTotBalances[rootchain.address], 'ray').toString().padStart(15)}

            //     ${'-'.repeat(40)}

            //     previous seig block : ${sb0}
            //     current seig block  : ${sb1}
            //     numBlocks           : ${sb1.sub(sb0)}

            //     seigPerBlock        : ${_WTON(await this.seigManager.seigPerBlock(), 'ray').toString().padStart(15)}
            //     totalSeig           : ${_WTON(totalSeig, 'ray').toString().padStart(15)}
            //     stakedSeig          : ${_WTON(stakedSeig, 'ray').toString().padStart(15)}
            //     unstakedSeig        : ${_WTON(unstakedSeig, 'ray').toString().padStart(15)}

            //     ${'='.repeat(40)}
            //     ${'='.repeat(40)}
            //     `);
            //   }

            //   this.currentSeigBlock = await this.seigManager.lastSeigBlock();
            //   this.currentTotTotalSupply = await this.tot.totalSupply();
            // });

            // afterEach(async function () {
            //   delete this.currentTotBalances;

            //   delete this.previousSeigBlock;
            //   delete this.currentSeigBlock;

            //   delete this.previousTotTotalSupply;
            //   delete this.currentTotTotalSupply;
            // });

            // for (const i in indices) {
            //   it(`${i}-th root chain: tot balance of root chain and coinage balance of token owner should be increased`, async function () {
            //     const rootchain = this.rootchains[Number(i)];

            //     const nBlocks = this.currentSeigBlocks[rootchain.address].sub(this.previousSeigBlocks[rootchain.address]).toNumber();

            //     const totalSeig = SEIG_PER_BLOCK.times(nBlocks)
            //       .times(totalStakedAmount.times(WTON_TON_RATIO).plus(this.accSeig))
            //       .div(TON_INITIAL_SUPPLY.times(WTON_TON_RATIO).plus(this.accSeig));

            //     this.accSeig = this.accSeig.plus(totalSeig);

            //     console.log(`
            //     totalSeig     : ${totalSeig.toString().padStart(15)}
            //     this.accSeig  : ${this.accSeig.toString().padStart(15)}
            //     `);

            //     const expectedBalance = tokenAmount.times(WTON_TON_RATIO)
            //       .plus(this.accSeig.div(NUM_ROOTCHAINS));

            //     checkBalance(
            //       this.currentTotBalances[rootchain.address],
            //       expectedBalance,
            //       WTON_UNIT,
            //     );

            //     await checkBalanceProm(
            //       this.coinagesByRootChain[rootchain.address].balanceOf(tokenOwner),
            //       expectedBalance,
            //       WTON_UNIT,
            //     );
            //   });
            // }
            it('second?', function () {
              console.log('tt');
            });
          });
        });
      }
    });
  });
});
