pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ERC20Mintable } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { DSMath } from "coinage-token/contracts/lib/DSMath.sol";
import { FixedIncrementCoinageMock as FixedIncrementCoinage } from "coinage-token/contracts/mock/FixedIncrementCoinageMock.sol";
import { CustomIncrementCoinageMock as CustomIncrementCoinage } from "coinage-token/contracts/mock/CustomIncrementCoinageMock.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { DepositManager } from "./DepositManager.sol";


/**
 * @dev SeigManager gives seigniorage to operator and WTON holders.
 * For each commit by operator, operator (or user) will get seigniorage
 * in propotion to the staked (or delegated) amount of WTON.
 *
 * {tot} tracks total staked or delegated WTON of each RootChain contract.
 * {coinages[rootchain]} tracks staked or delegated WTON of user or operator to a RootChain contract.
 *
 * For each commit by operator,
 *  1. increases all root chains' balance of {tot} by (the staked amount of WTON) /
 *     (total supply of TON and WTON) * (num blocks * seigniorage per block).
 *  2. increases all depositors' blanace of {coinages[rootchain]} in proportion to the staked amount of WTON,
 *     up to the increased amount in step (1).
 *
 * For each stake or delegate with amount of {v} to a RootChain,
 *  1. mint {v} {coinages[rootchain]} tokens to the depositor
 *  2. mint {v} {tot} tokens to the root chain contract
 *
 * For each unstake or undelegate (or get rewards) with amount of {v} to a RootChain,
 *  1. burn {v} {coinages[rootchain]} tokens to the depositor
 *  2. burn {v + ⍺} {tot} tokens to the root chain contract,
 *   where ⍺ = tot.seigPerBlock() * num blocks * v / tot.balanceOf(rootchain)
 *
 */
contract SeigManager  is DSMath, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for ERC20Mintable;

  //////////////////////////////
  // Common contracts
  //////////////////////////////

  RootChainRegistry public registry;
  DepositManager public depositManager;

  //////////////////////////////
  // Token-related
  //////////////////////////////

  // WTON token contract
  ERC20Mintable public ton;

  // WTON token contract
  ERC20Mintable public wton; // TODO: use mintable erc20!

  // TODO: fixed seig? 스테이크된 양에 비례해서!
  // track total deposits of each root chain.
  CustomIncrementCoinage public tot;

  // coinage token for each root chain.
  mapping (address => CustomIncrementCoinage) public coinages;

  // last commit block number for each root chain.
  mapping (address => uint256) public lastCommitBlock;

  // total seigniorage per block
  uint256 public seigPerBlock;

  // the block number when seigniorages are given
  uint256 public lastSeigBlock;


  //////////////////////////////
  // Constants
  //////////////////////////////

  uint256 constant public DEFAULT_FACTOR = 10 ** 27;

  //////////////////////////////
  // Modifiers
  //////////////////////////////

  modifier onlyRegistry() {
    require(msg.sender == address(registry));
    _;
  }

  modifier onlyDepositManager() {
    require(msg.sender == address(depositManager));
    _;
  }


  modifier onlyRootChain(address rootchain) {
    require(registry.rootchains(rootchain));
    _;
  }

  modifier checkCoinage(address rootchain) {
    require(address(coinages[rootchain]) != address(0), "SeigManager: coinage has not been deployed yet");
    _;
  }

  //////////////////////////////
  // Events
  //////////////////////////////

  event CoinageCreated(address rootchain, address coinage);

  //////////////////////////////
  // Constuctor
  //////////////////////////////

  constructor (
    ERC20Mintable _ton,
    ERC20Mintable _wton,
    RootChainRegistry _registry,
    DepositManager _depositManager,
    uint256 _seigPerBlock
  ) public {
    ton = _ton;
    wton = _wton;
    registry = _registry;
    depositManager = _depositManager;
    seigPerBlock = _seigPerBlock;

    tot = new CustomIncrementCoinage(
      "",
      "",
      DEFAULT_FACTOR,
      false
    );

    lastSeigBlock = block.number;
  }

  //////////////////////////////
  // External functions
  //////////////////////////////

  /**
   * @dev deploy coinage token for the root chain.
   */
  function deployCoinage(address rootchain) external onlyRegistry returns (bool) {
    // short circuit if already coinage is deployed
    if (address(coinages[rootchain]) != address(0)) {
      return false;
    }

    // create new coinage token for the root chain contract
    if (address(coinages[rootchain]) == address(0)) {
      coinages[rootchain] = new CustomIncrementCoinage(
        "",
        "",
        DEFAULT_FACTOR,
        false
      );
      lastCommitBlock[rootchain] = block.number;
      emit CoinageCreated(rootchain, address(coinages[rootchain]));
    }

    return true;
  }

  /**
   * @dev A proxy function for a new commit
   */
  function onCommit(address rootchain)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    uint256 prevTotalSupply;
    uint256 nextTotalSupply;

    // 1. increase total supply of {tot} by seigniorages * (total staked amount of WTON / total supply of TON and WTON)

    prevTotalSupply = tot.totalSupply();

    // maximum seigniorages
    uint256 totalSeig = (block.number - lastSeigBlock) * seigPerBlock;

    uint256 seig = (
      rdiv(
        rmul(
          totalSeig,
          // total staked amount of WTON
          wton.balanceOf(address(depositManager)).sub(depositManager.pendingWithdrawalAmount())
        ),
        // total supply of WTON and TON
        wton.totalSupply().add(ton.totalSupply())
      )
    );

    nextTotalSupply = prevTotalSupply.add(seig);

    tot.setFactor(
      rdiv(
        nextTotalSupply,
        prevTotalSupply
      )
    );

    lastSeigBlock = block.number;

    // 2. increase total supply of {coinages[rootchain]}
    CustomIncrementCoinage coinage = coinages[rootchain];

    prevTotalSupply = coinage.totalSupply();
    nextTotalSupply = tot.balanceOf(rootchain);

    coinage.setFactor(rdiv(nextTotalSupply, prevTotalSupply));

    // gives seigniorages to the root chain as coinage

    lastCommitBlock[rootchain] = block.number;
    wton.mint(address(this), nextTotalSupply.sub(prevTotalSupply));
    return true;
  }

  /**
   * @dev A proxy function for a new deposit
   */
  function onStake(address rootchain, address depositor, uint256 amount)
    external
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    coinages[rootchain].mint(depositor, amount);
    tot.mint(rootchain, amount);
    return true;
  }

  function onUnstake(address rootchain, address depositor, uint256 amount)
    public
    onlyDepositManager
    checkCoinage(rootchain)
    returns (bool)
  {
    uint256 totAmount = seigPerBlock
      .mul(block.number - lastCommitBlock[rootchain])
      .mul(rdiv(amount, tot.balanceOf(rootchain)));
    totAmount = totAmount.add(amount);

    coinages[rootchain].burnFrom(depositor, amount);
    tot.burnFrom(rootchain, totAmount);

    wton.safeTransfer(address(depositManager), amount);
    return true;
  }

  //////////////////////////////
  // Public and internal fuhnctions
  //////////////////////////////

  function uncomittedRewardOf(address rootchain, address depositor) public view returns (uint256) {
    CustomIncrementCoinage coinage = coinages[rootchain];

    uint256 prevTotalSupply = coinage.totalSupply();
    uint256 nextTotalSupply = tot.balanceOf(rootchain);
    uint256 newFactor = rdiv(nextTotalSupply, prevTotalSupply);

    uint256 uncomittedBalance = rmul(
      rdiv(coinage.balanceOf(depositor), coinage.factor()),
      newFactor
    );

    return uncomittedBalance
      .sub(coinages[rootchain].balanceOf(depositor));
  }

  function rewardOf(address rootchain, address depositor) public view returns (uint256) {
    return coinages[rootchain].balanceOf(depositor).sub(depositManager.deposits(rootchain, depositor));
  }

  function _onstake() internal returns (bool) {

  }

  function _getStakeStats() internal returns (uint256 stakedAmount, uint256 unstakedAmount) {
    stakedAmount = wton.balanceOf(address(depositManager));
    unstakedAmount = wton.totalSupply().sub(stakedAmount);
  }
}