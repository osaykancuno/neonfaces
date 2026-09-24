// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical ERC-6551 registry interface.
/// Deployed at 0x000000006551c19487814612e58FE06813775758 on Robinhood Chain mainnet (4663) and
/// testnet (46630); runtime codehash matches Ethereum mainnet
/// (0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735).
interface IERC6551Registry {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    error AccountCreationFailed();

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address account);
}
