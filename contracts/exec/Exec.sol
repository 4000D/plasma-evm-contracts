pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Address } from "../../node_modules/openzeppelin-solidity/contracts/utils/Address.sol";

contract Exec is Ownable {
  using Address for *;

  function multiExec(address[] calldata targets, uint256[] calldata values, bytes[] calldata datas) external payable onlyOwner {
    require(targets.length == datas.length, "VaultBase: array length mismatch");
    require(targets.length == values.length, "VaultBase: array length mismatch");

    for (uint256 i = 0; i < targets.length; i++) {
      exec(targets[i].toPayable(), values[i], datas[i]);
    }
  }

  function exec(address payable target, uint256 value, bytes memory data) public payable onlyOwner {
    (bool ok, bytes memory _) = target.call.value(value)(data);
    require(ok, "VaultBase: failed to execute");
  }
}