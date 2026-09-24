// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC6551} from "solady/accounts/ERC6551.sol";

/// @title NeonFaceAccount — the wallet behind every Face (ERC-6551 implementation)
/// @notice Immutable ERC-6551 account. The holder of the Face NFT fully controls it.
/// On top of the standard account, the holder can delegate a narrowly-scoped **agent**:
///  - the agent can only call (target, selector) pairs the holder explicitly allowed,
///  - it can never move ETH, never call the account itself, never sign (ERC-1271 stays holder-only),
///  - it expires, and it dies automatically when the Face is sold (delegations are bound to the
///    holder that granted them).
/// The holder stays the owner; the agent is only an executor.
/// @dev Deployed once; every Face gets a minimal proxy from the canonical ERC-6551 registry.
contract NeonFaceAccount is ERC6551 {
    struct Permission {
        address target;
        bytes4 selector;
    }

    struct AgentConfig {
        address agent;
        address grantor; // Face holder at grant time; delegation is void once the Face changes hands
        uint64 expiry;
        uint64 epoch; // bumps on every (re)configuration, wiping previous permissions
    }

    AgentConfig internal _agent;
    mapping(uint64 epoch => mapping(address target => mapping(bytes4 selector => bool))) internal _allowed;

    event AgentSet(address indexed agent, address indexed grantor, uint64 expiry, uint64 epoch, Permission[] permissions);
    event AgentRevoked(uint64 epoch);
    event AgentExecuted(address indexed agent, address indexed target, bytes4 selector);

    error AgentNotActive();
    error AgentCallNotAllowed();
    error InvalidAgentConfig();

    // ------------------------------------------------------------------
    // Agent delegation
    // ------------------------------------------------------------------

    /// @notice Delegate an agent. Replaces any previous agent and its permissions.
    function setAgent(address agent, uint64 expiry, Permission[] calldata permissions) external onlyValidSigner {
        if (agent == address(0) || agent == address(this) || expiry <= block.timestamp) {
            revert InvalidAgentConfig();
        }
        uint64 epoch = _agent.epoch + 1;
        for (uint256 i; i < permissions.length; ++i) {
            if (permissions[i].target == address(this) || permissions[i].target == address(0)) {
                revert InvalidAgentConfig();
            }
            _allowed[epoch][permissions[i].target][permissions[i].selector] = true;
        }
        _agent = AgentConfig({agent: agent, grantor: msg.sender, expiry: expiry, epoch: epoch});
        _updateState();
        emit AgentSet(agent, msg.sender, expiry, epoch, permissions);
    }

    /// @notice Remove the agent and all its permissions.
    function revokeAgent() external onlyValidSigner {
        uint64 epoch = _agent.epoch + 1;
        _agent = AgentConfig({agent: address(0), grantor: address(0), expiry: 0, epoch: epoch});
        _updateState();
        emit AgentRevoked(epoch);
    }

    /// @notice Agent entry point: a zero-value CALL to an allowed (target, selector).
    function executeAsAgent(address target, bytes calldata data) external returns (bytes memory result) {
        AgentConfig memory cfg = _agent;
        if (!_agentActive(cfg) || msg.sender != cfg.agent) revert AgentNotActive();
        if (data.length < 4) revert AgentCallNotAllowed();
        bytes4 selector = bytes4(data[:4]);
        if (!_allowed[cfg.epoch][target][selector]) revert AgentCallNotAllowed();

        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        _updateState();
        emit AgentExecuted(msg.sender, target, selector);
    }

    function agentConfig() external view returns (address agent, address grantor, uint64 expiry, bool active) {
        AgentConfig memory cfg = _agent;
        return (cfg.agent, cfg.grantor, cfg.expiry, _agentActive(cfg));
    }

    function isAgentCallAllowed(address target, bytes4 selector) external view returns (bool) {
        AgentConfig memory cfg = _agent;
        return _agentActive(cfg) && _allowed[cfg.epoch][target][selector];
    }

    function _agentActive(AgentConfig memory cfg) internal view returns (bool) {
        return cfg.agent != address(0) && block.timestamp <= cfg.expiry && cfg.grantor == owner();
    }

    // ------------------------------------------------------------------
    // Hardening of the Solady base
    // ------------------------------------------------------------------

    /// @dev Immutable: no upgrades, ever.
    function _authorizeUpgrade(address) internal pure override {
        revert Unauthorized();
    }

    /// @dev No LibZip calldata fallback: unknown selectors revert.
    function _useLibZipCdFallback() internal pure override returns (bool) {
        return false;
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("NeonFaceAccount", "1");
    }
}
