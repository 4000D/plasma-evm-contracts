pragma solidity ^0.5.12;


import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract DelegateExecStorage is Ownable {
  address payable public implementation;
  bytes32[98] private buf; // 100 - 2 for Ownable.owner, DelegateExec.implementation
}