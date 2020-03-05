pragma solidity ^0.5.12;

import { DelegateExecStorage } from  "../../exec/DelegateExecStorage.sol";

contract VaultStorage is DelegateExecStorage {
  // some storages...

  bytes32[1000] buf;
}