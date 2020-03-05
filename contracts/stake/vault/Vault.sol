pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { VaultStorage } from  "./VaultStorage.sol";


/**
 * @notice Vault is a implementation of TON and WTON vault to swap, stake, and unstake.
 * All message-calls invoked by Vault are authorized and implemented in Exec.sol.
 * Below empty implementation is just reserved for future functions that are readily
 * accessible to the contract, but are not mandatory.
 */
contract Vault is VaultStorage {

}