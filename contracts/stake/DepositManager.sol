pragma solidity ^0.5.0;

import { Ownable } from "openzeppelin-solidity/contracts/ownership/OWnable.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import { RootChainI } from "../RootChainI.sol";
import { RootChainRegistry } from "./RootChainRegistry.sol";
import { SeigManager } from "./SeigManager.sol";

// TODO: add events

/**
 * @dev DepositManager manages WTON deposit and withdrawal from operator and WTON holders.
 */
contract DepositManager is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public wton;
  RootChainRegistry public registry;
  SeigManager public seigManager;

  // rootchian => msg.sender => wton amount
  mapping (address => mapping (address => uint256)) public deposits;

  // rootchain => msg.sender => withdrawal requests
  mapping (address => mapping (address => WithdrawalReqeust[])) public withdrawalReqeusts;

  // rootchain => msg.sender => index
  mapping (address => mapping (address => uint256)) public withdrawalRequestIndex;

  uint256 public totalPendingWithdrawalAmount;
  mapping (address => uint256) public pendingWithdrawalAmount;

  // withdrawal delay in block number
  // @TODO: change delay unit to CYCLE?
  uint256 public WITHDRAWAL_DELAY;

  struct WithdrawalReqeust {
    uint128 withdrawableBlockNumber;
    uint128 amount;
    bool processed;
  }

  modifier onlyRootChain(address rootchain) {
    require(registry.rootchains(rootchain));
    _;
  }

  modifier onlySeigManager() {
    require(msg.sender == address(seigManager));
    _;
  }

  ////////////////////
  // Events
  ////////////////////
  event Deposited(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalRequested(address indexed rootchain, address depositor, uint256 amount);
  event WithdrawalProcessed(address indexed rootchain, address depositor, uint256 amount);

  constructor (
    IERC20 _wton,
    RootChainRegistry _registry,
    uint256 _WITHDRAWAL_DELAY
  ) public {
    wton = _wton;
    registry = _registry;
    WITHDRAWAL_DELAY = _WITHDRAWAL_DELAY;
  }

  function setSeigManager(SeigManager _seigManager) external onlyOwner {
    require(address(seigManager) == address(0), "DepositManager: SeigManager is already set");
    seigManager = _seigManager;
  }

  /**
   * @dev deposit `amount` WTON in RAY
   */
  function deposit(address rootchain, uint256 amount) public onlyRootChain(rootchain) returns (bool) {
    deposits[rootchain][msg.sender] = deposits[rootchain][msg.sender].add(amount);

    wton.safeTransferFrom(msg.sender, address(this), amount);

    emit Deposited(rootchain, msg.sender, amount);

    require(seigManager.onStake(rootchain, msg.sender, amount));

    return true;
  }

  function requestWithdrawal(address rootchain, uint256 amount) public onlyRootChain(rootchain) returns (bool) {
    deposits[rootchain][msg.sender] = deposits[rootchain][msg.sender].sub(amount);

    withdrawalReqeusts[rootchain][msg.sender].push(WithdrawalReqeust({
      withdrawableBlockNumber: uint128(block.number + WITHDRAWAL_DELAY),
      amount: uint128(amount),
      processed: false
    }));

    totalPendingWithdrawalAmount = totalPendingWithdrawalAmount.add(amount);
    pendingWithdrawalAmount[rootchain] = pendingWithdrawalAmount[rootchain].add(amount);

    emit WithdrawalRequested(rootchain, msg.sender, amount);
  }

  function processRequest(address rootchain) public {
    uint256 index = withdrawalRequestIndex[rootchain][msg.sender];
    require(withdrawalReqeusts[rootchain][msg.sender].length > index, "DepositManager: no request to process");

    WithdrawalReqeust storage r = withdrawalReqeusts[rootchain][msg.sender][index];

    require(r.withdrawableBlockNumber <= block.number, "DepositManager: wait for withdrawal delay");
    r.processed = true;

    withdrawalRequestIndex[rootchain][msg.sender] += 1;

    totalPendingWithdrawalAmount = totalPendingWithdrawalAmount.sub(r.amount);
    pendingWithdrawalAmount[rootchain] = pendingWithdrawalAmount[rootchain].sub(r.amount);

    wton.safeTransfer(msg.sender, r.amount);

    emit WithdrawalProcessed(rootchain, msg.sender, r.amount);
  }

  /**
   * @dev unstake or claim rewards
   */
  function unstake(address rootchain, uint256 amount) public onlyRootChain(rootchain) returns (bool) {
    require(seigManager.onUnstake(rootchain, msg.sender, amount));

    deposits[rootchain][msg.sender] = deposits[rootchain][msg.sender].add(amount);
    return true;
  }

  function unstakeAll(address rootchain) external onlyRootChain(rootchain) returns (bool) {
    uint256 amount;

    // TODO: calculate unstakable amount

    unstake(rootchain, amount);
    return true;
  }


  function processRequests(address rootchain, uint256 n) external {
    for (uint256 i = 0; i < n; i++) {
      processRequest(rootchain);
    }
  }

  function _isOperator(address rootchain, address operator) internal view returns (bool) {
    return operator == RootChainI(rootchain).operator();
  }
}