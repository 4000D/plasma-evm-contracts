pragma solidity ^0.5.12;


import { Ownable } from "../../node_modules/openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { Address } from "../../node_modules/openzeppelin-solidity/contracts/utils/Address.sol";

import { DelegateExecStorage } from "./DelegateExecStorage.sol";


contract DelegateExec is Ownable, DelegateExecStorage {
  using Address for *;

  uint256 internal constant FWD_GAS_LIMIT = 10000;

  function setImplementation(address payable _implementation) public onlyOwner {
    implementation = _implementation;
  }

  /**
   * https://github.com/aragon/aragonOS/blob/next/contracts/common/DelegateProxy.sol
   * @dev Performs a delegatecall and returns whatever the delegatecall returned (entire context execution will return!)
   * @param _dst Destination address to perform the delegatecall
   * @param _calldata Calldata for the delegatecall
   */
  function delegateExec(address _dst, bytes memory _calldata) internal {
    require(_dst.isContract());
    uint256 fwdGasLimit = FWD_GAS_LIMIT;

    assembly {
      let result := delegatecall(sub(gas, fwdGasLimit), _dst, add(_calldata, 0x20), mload(_calldata), 0, 0)
      let size := returndatasize
      let ptr := mload(0x40)
      returndatacopy(ptr, 0, size)

      // revert instead of invalid() bc if the underlying call failed with invalid() it already wasted gas.
      // if the call returned error data, forward it
      switch result case 0 { revert(ptr, size) }
      default { return(ptr, size) }
    }
  }

  function () external payable onlyOwner {
    delegateExec(implementation, msg.data);
  }
}