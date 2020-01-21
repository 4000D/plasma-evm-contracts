const { range, last, first } = require('lodash');

const { createCurrency } = require('@makerdao/currency');
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

const LOGTX = process.env.LOGTX || false;
const VERBOSE = process.env.VERBOSE || false;

const development = true;

const _TON = createCurrency('TON');
const _WTON = createCurrency('WTON');

const TON_UNIT = 'wei';
const WTON_UNIT = 'ray';

const [operator, tokenOwner] = accounts;

const dummyStatesRoot = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';
const dummyTransactionsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
const dummyReceiptsRoot = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';

const TON_INITIAL_SUPPLY = _TON('100');
const SEIG_PER_BLOCK = TON_INITIAL_SUPPLY.div(10 * 100); // 0.1 TON
const WITHDRAWAL_DELAY = 10;
const NUM_ROOTCHAINS = 4;

const tokenAmount = TON_INITIAL_SUPPLY.div(100); // 1 TON
const tokwnOwnerInitialBalance = tokenAmount.times(NUM_ROOTCHAINS);

class RootChainState {
  constructor (NRE_LENGTH) {
    this.currentFork = 1;
  }
}

describe.only('stake/SeigManager', function () {
  function makePos (v1, v2) { return web3.utils.toBN(v1).shln(128).add(web3.utils.toBN(v2)); }

  async function submitDummyNRE (rootchain, blockNumber) {
    const pos1 = makePos(1, blockNumber);
    const pos2 = makePos(blockNumber, blockNumber);

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
      1,
      dummyStatesRoot,
      dummyTransactionsRoot,
      dummyReceiptsRoot,
    )));

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
      SEIG_PER_BLOCK.toFixed('ray'),
    );

    await this.depositManager.setSeigManager(this.seigManager.address);

    await Promise.all(this.rootchains.map(rootchain => this.registry.registerAndDeployCoinage(rootchain.address, this.seigManager.address)));

    await this.ton.mint(defaultSender, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));
    await this.ton.approve(this.wton.address, TON_INITIAL_SUPPLY.toFixed(TON_UNIT));

    await this.wton.swapFromTONAndTransfer(tokenOwner, tokwnOwnerInitialBalance.toFixed(TON_UNIT));
    await this.wton.approve(this.depositManager.address, tokwnOwnerInitialBalance.toFixed(WTON_UNIT), { from: tokenOwner });

    const coinageAddrs = await Promise.all(
      this.rootchains.map(rootchain => this.seigManager.coinages(rootchain.address)),
    );

    this.coinages = [];
    this.coinagesByRootChain = {};
    for (const addr of coinageAddrs) {
      const i = coinageAddrs.findIndex(a => a === addr);
      this.coinages[i] = await CustomIncrementCoinage.at(addr);
      this.coinagesByRootChain[this.rootchains[i]] = this.coinages[i];
    }

    this.tot = await CustomIncrementCoinage.at(await this.seigManager.tot());

    // contract-call wrapper functions
    this._deposit = (from, to, amount) => this.depositManager.deposit(to, amount, { from });
  });

  describe('when the token owner deposits WTON', function () {
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

    it('the token owner should have no WTON tokens at all', async function () {
      expect(await this.wton.balanceOf(tokenOwner)).to.be.bignumber.equal('0');
    });

    it('deposit manager should have deposited WTON tokens', async function () {
      expect(await this.wton.balanceOf(this.depositManager.address)).to.be.bignumber.equal(tokenAmount.times(NUM_ROOTCHAINS).toFixed(WTON_UNIT));
    });

    it('coinage balance of the tokwn owner must be increased', async function () {
      for (const coinage of this.coinages) {
        expect(await coinage.balanceOf(tokenOwner)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
      }
    });

    it('tot balance of root chain must be increased', async function () {
      for (const rootchain of this.rootchains) {
        expect(await this.tot.balanceOf(rootchain.address)).to.be.bignumber.equal(tokenAmount.toFixed(WTON_UNIT));
      }
    });
  });
});
