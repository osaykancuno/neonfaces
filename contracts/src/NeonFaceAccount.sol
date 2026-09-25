// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC6551} from "solady/accounts/ERC6551.sol";

/// @title NeonFaceAccount — the wallet behind every Face (ERC-6551 implementation)
/// @notice Immutable ERC-6551 account. The holder of the Face NFT fully controls it:
///  `execute` / `executeBatch` any call, receive ETH / ERC-20 / ERC-721 / ERC-1155, ERC-1271 signatures.
///
/// **Agents.** The holder can delegate one agent (a bot, a strategy contract, an AI agent key):
///  - it may only call the (target, selector) pairs the holder allowed — nothing else, never the account itself;
///  - it may spend ETH from the account only up to an allowance set by the holder;
///  - it can batch calls (e.g. approve + swap) atomically;
///  - it can never sign for the account (ERC-1271 stays holder-only);
///  - it expires, and it dies automatically when the Face changes hands (bound to the granting holder).
/// The holder stays the owner; the agent is only an executor.
///
/// **Faces inside Faces.** A Face can sit in another Face's account (a set piece inside its anchor). Its holder
/// is then the holder of the outermost Face (`holder()`): an agent is bound to that wallet, so it dies when the
/// outer Face is sold, and a lock on any Face above also locks this account (`effectiveLockedUntil()`).
///
/// **Lock.** The holder can lock the account until a timestamp (e.g. while the Face is listed): until then
/// nothing leaves the account — no holder call, no agent call, no ERC-1271 signature. The lock survives a
/// sale, so a buyer can check `lockedUntil()` before buying and be sure the contents can't be drained
/// between listing and purchase. A lock can only be extended, at most 365 days ahead.
/// Note: ERC-20 allowances granted *before* locking remain valid at the token level — revoke them first.
/// Faces approved to an operator before locking can't leave: NeonFaces refuses transfers out of a locked account.
/// @dev Deployed once; every Face gets a minimal proxy from the canonical ERC-6551 registry.
contract NeonFaceAccount is ERC6551 {
    struct Permission {
        address target;
        bytes4 selector;
    }

    struct AgentConfig {
        address agent;
        address grantor; // holder() at grant time; void once the Face (or the Face it sits in) changes hands
        uint64 expiry;
        uint64 epoch; // bumps on every (re)configuration, wiping previous permissions and allowance
    }

    uint256 public constant MAX_LOCK = 365 days;
    /// @notice Face accounts walked above this one. Deeper stacks count as locked, with no holder, until the outer
    /// Faces are taken apart (NeonFaces caps each move at 4 levels; only a deliberate stack gets deeper).
    uint256 public constant MAX_DEPTH = 8;

    AgentConfig internal _agent;
    mapping(uint64 epoch => mapping(address target => mapping(bytes4 selector => bool))) internal _allowed;
    mapping(uint64 epoch => uint256) internal _valueAllowance;
    uint64 public lockedUntil;

    event AgentSet(address indexed agent, address indexed grantor, uint64 expiry, uint64 epoch, uint256 valueAllowance);
    event AgentPermissionsUpdated(uint64 indexed epoch, Permission[] permissions, bool allowed);
    event AgentValueAllowanceSet(uint64 indexed epoch, uint256 valueAllowance);
    event AgentRevoked(uint64 epoch);
    event AgentExecuted(address indexed agent, address indexed target, bytes4 selector, uint256 value);
    event AccountLocked(uint64 until);

    error AgentNotActive();
    error AgentCallNotAllowed(address target, bytes4 selector);
    error AgentValueExceeded(uint256 requested, uint256 remaining);
    error InvalidAgentConfig();
    error AccountIsLocked(uint64 until);
    error InvalidLock();

    modifier notLocked() {
        (, uint64 until) = _above();
        if (block.timestamp < until) revert AccountIsLocked(until);
        _;
    }

    // ------------------------------------------------------------------
    // Holder execution (Solady) — blocked while locked
    // ------------------------------------------------------------------
    function execute(address target, uint256 value, bytes calldata data, uint8 operation)
        public
        payable
        override
        notLocked
        returns (bytes memory)
    {
        return super.execute(target, value, data, operation);
    }

    function executeBatch(Call[] calldata calls, uint8 operation)
        public
        payable
        override
        notLocked
        returns (bytes[] memory)
    {
        return super.executeBatch(calls, operation);
    }

    // ------------------------------------------------------------------
    // Lock
    // ------------------------------------------------------------------

    /// @notice Freeze everything that can move assets out of this account until `until` (unix seconds).
    function lock(uint64 until) external onlyValidSigner {
        if (until <= lockedUntil || until <= block.timestamp || until > block.timestamp + MAX_LOCK) revert InvalidLock();
        lockedUntil = until;
        _updateState();
        emit AccountLocked(until);
    }

    /// @notice True while this account, or the account of any Face it sits inside, is locked.
    function isLocked() public view returns (bool) {
        return block.timestamp < effectiveLockedUntil();
    }

    /// @notice The latest lock over this account: its own, or a later one on any Face account above it.
    function effectiveLockedUntil() public view returns (uint64 until) {
        (, until) = _above();
    }

    /// @notice The wallet in control: the Face's holder, or the holder of the outermost Face it sits inside.
    function holder() public view returns (address top) {
        (top,) = _above();
    }

    /// @dev Walks up through the Face accounts (same chain, same collection) that hold this Face: the wallet at
    /// the top and the latest lock on the way. Past MAX_DEPTH: no holder, locked.
    function _above() internal view returns (address top, uint64 until) {
        until = lockedUntil;
        (uint256 chainId, address tokenContract,) = token();
        top = owner();
        for (uint256 depth; top.code.length != 0; ++depth) {
            (bool ok, bytes memory r) = top.staticcall{gas: 30_000}(abi.encodeWithSignature("token()"));
            if (!ok || r.length != 96) break;
            (uint256 c, uint256 t, uint256 id) = abi.decode(r, (uint256, uint256, uint256));
            if (c != chainId || t != uint256(uint160(tokenContract))) break;
            if (depth == MAX_DEPTH) return (address(0), type(uint64).max);
            (ok, r) = top.staticcall{gas: 30_000}(abi.encodeWithSignature("lockedUntil()"));
            if (ok && r.length == 32) {
                uint256 u = abi.decode(r, (uint256));
                if (u > until) until = u > type(uint64).max ? type(uint64).max : uint64(u);
            }
            (ok, r) = tokenContract.staticcall(abi.encodeWithSignature("ownerOf(uint256)", id));
            if (!ok || r.length != 32) return (address(0), until);
            top = address(uint160(abi.decode(r, (uint256))));
        }
    }

    // ------------------------------------------------------------------
    // Agent configuration (holder only)
    // ------------------------------------------------------------------

    /// @notice Delegate an agent. Replaces any previous agent, its permissions and its ETH allowance.
    function setAgent(address agent, uint64 expiry, Permission[] calldata permissions, uint256 valueAllowance)
        external
        onlyValidSigner
        notLocked
    {
        address top = holder();
        if (agent == address(0) || agent == address(this) || expiry <= block.timestamp || top == address(0)) {
            revert InvalidAgentConfig();
        }
        uint64 epoch = _agent.epoch + 1;
        _agent = AgentConfig({agent: agent, grantor: top, expiry: expiry, epoch: epoch});
        _setPermissions(epoch, permissions, true);
        _valueAllowance[epoch] = valueAllowance;
        _updateState();
        emit AgentSet(agent, top, expiry, epoch, valueAllowance);
    }

    /// @notice Add (`allowed = true`) or remove calls for the current agent without resetting it.
    function setAgentPermissions(Permission[] calldata permissions, bool allowed) external onlyValidSigner notLocked {
        if (_agent.agent == address(0)) revert InvalidAgentConfig();
        _setPermissions(_agent.epoch, permissions, allowed);
        _updateState();
    }

    /// @notice Set how much ETH (wei) the current agent may still spend from this account.
    function setAgentValueAllowance(uint256 valueAllowance) external onlyValidSigner notLocked {
        if (_agent.agent == address(0)) revert InvalidAgentConfig();
        _valueAllowance[_agent.epoch] = valueAllowance;
        _updateState();
        emit AgentValueAllowanceSet(_agent.epoch, valueAllowance);
    }

    /// @notice Remove the agent, its permissions and its allowance. Allowed even while locked.
    function revokeAgent() external onlyValidSigner {
        uint64 epoch = _agent.epoch + 1;
        _agent = AgentConfig({agent: address(0), grantor: address(0), expiry: 0, epoch: epoch});
        _updateState();
        emit AgentRevoked(epoch);
    }

    function _setPermissions(uint64 epoch, Permission[] calldata permissions, bool allowed) internal {
        for (uint256 i; i < permissions.length; ++i) {
            address t = permissions[i].target;
            if (t == address(this) || t == address(0)) revert InvalidAgentConfig();
            _allowed[epoch][t][permissions[i].selector] = allowed;
        }
        emit AgentPermissionsUpdated(epoch, permissions, allowed);
    }

    // ------------------------------------------------------------------
    // Agent execution
    // ------------------------------------------------------------------

    /// @notice Agent entry point: a CALL to an allowed (target, selector), optionally spending ETH
    /// from the account within the agent's allowance.
    function executeAsAgent(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        AgentConfig memory cfg = _checkAgent();
        bytes memory result = _agentCall(cfg, target, value, data);
        _updateState();
        return result;
    }

    /// @notice Several agent calls, atomically (all succeed or all revert).
    function executeBatchAsAgent(Call[] calldata calls) external returns (bytes[] memory results) {
        AgentConfig memory cfg = _checkAgent();
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            results[i] = _agentCall(cfg, calls[i].target, calls[i].value, calls[i].data);
        }
        _updateState();
    }

    function _checkAgent() internal view returns (AgentConfig memory cfg) {
        (address top, uint64 until) = _above();
        if (block.timestamp < until) revert AccountIsLocked(until);
        cfg = _agent;
        if (!_agentActive(cfg, top) || msg.sender != cfg.agent) revert AgentNotActive();
    }

    function _agentCall(AgentConfig memory cfg, address target, uint256 value, bytes calldata data)
        internal
        returns (bytes memory result)
    {
        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        if (data.length < 4 || !_allowed[cfg.epoch][target][selector]) revert AgentCallNotAllowed(target, selector);
        if (value != 0) {
            uint256 remaining = _valueAllowance[cfg.epoch];
            if (value > remaining) revert AgentValueExceeded(value, remaining);
            _valueAllowance[cfg.epoch] = remaining - value; // effects before the external call
        }
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        emit AgentExecuted(msg.sender, target, selector, value);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function agentConfig()
        external
        view
        returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)
    {
        AgentConfig memory cfg = _agent;
        return (cfg.agent, cfg.grantor, cfg.expiry, _agentActive(cfg, holder()), _valueAllowance[cfg.epoch]);
    }

    function isAgentCallAllowed(address target, bytes4 selector) external view returns (bool) {
        AgentConfig memory cfg = _agent;
        (address top, uint64 until) = _above();
        return _agentActive(cfg, top) && block.timestamp >= until && _allowed[cfg.epoch][target][selector];
    }

    function _agentActive(AgentConfig memory cfg, address top) internal view returns (bool) {
        return cfg.agent != address(0) && block.timestamp <= cfg.expiry && cfg.grantor == top;
    }

    // ------------------------------------------------------------------
    // Signatures: holder only, and never while locked
    // ------------------------------------------------------------------
    function isValidSignature(bytes32 hash, bytes calldata signature) public view override returns (bytes4) {
        if (isLocked()) return 0xffffffff;
        return super.isValidSignature(hash, signature);
    }

    function isValidSigner(address signer, bytes calldata context) public view override returns (bytes4) {
        if (isLocked()) return bytes4(0);
        return super.isValidSigner(signer, context);
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
