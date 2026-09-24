// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC6551} from "solady/accounts/ERC6551.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {MockRouter, MiniSmartWallet} from "./mocks/MockRouter.sol";

/// @notice Everything a holder (and their agent) can do with a Face after mint.
contract AgentsTest is Base {
    MockRouter router;
    address agent = makeAddr("agent");
    NeonFaceAccount acc; // Face #1's account, held by alice

    function setUp() public override {
        super.setUp();
        router = new MockRouter();
        usdg.mint(address(router), 1e30); // 1:1 mock swaps pay raw units
        tsla.mint(address(router), 1_000e18);
        _openPublic();
        _mintPublic(alice, 2);
        acc = NeonFaceAccount(payable(seeder.accountOf(1)));
    }

    function _perms1(address t, bytes4 sel) internal pure returns (NeonFaceAccount.Permission[] memory p) {
        p = new NeonFaceAccount.Permission[](1);
        p[0] = NeonFaceAccount.Permission(t, sel);
    }

    function _delegate(NeonFaceAccount.Permission[] memory perms, uint256 valueAllowance) internal {
        vm.prank(alice);
        acc.setAgent(agent, uint64(block.timestamp + 30 days), perms, valueAllowance);
    }

    // =====================================================================
    // Holder: full control
    // =====================================================================
    function test_Holder_ExecuteBatchAndEth() public {
        vm.deal(address(acc), 1 ether);
        ERC6551.Call[] memory calls = new ERC6551.Call[](2);
        calls[0] = ERC6551.Call(bob, 0.4 ether, "");
        calls[1] = ERC6551.Call(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
        vm.prank(alice);
        acc.executeBatch(calls, 0);
        assertEq(bob.balance, 100 ether + 0.4 ether);
        assertEq(router.pings(), 1);
    }

    function test_Holder_NotSupportedOperations() public {
        vm.prank(alice);
        vm.expectRevert(ERC6551.OperationNotSupported.selector); // no delegatecall / create from the account
        acc.execute(address(router), 0, "", 1);
    }

    function test_Holder_FaceOwnsFace_NestedControl() public {
        // Face #2 is sent into Face #1's account; alice controls #2's account through #1's
        NeonFaceAccount acc2 = NeonFaceAccount(payable(seeder.accountOf(2)));
        vm.prank(alice);
        faces.safeTransferFrom(alice, address(acc), 2);
        assertEq(acc2.owner(), address(acc));
        address token = seeder.seedOf(2).legs[0].token;
        uint256 amt = seeder.seedOf(2).legs[0].amount;

        bytes memory inner = abi.encodeCall(ERC6551.execute, (token, 0, abi.encodeCall(IERC20.transfer, (alice, amt)), 0));
        vm.prank(alice);
        acc.execute(address(acc2), 0, inner, 0);
        assertEq(IERC20(token).balanceOf(alice), amt);
    }

    function test_Holder_SmartWalletHolder() public {
        MiniSmartWallet safe = new MiniSmartWallet(alice);
        vm.prank(alice);
        faces.safeTransferFrom(alice, address(safe), 1);
        address token = seeder.seedOf(1).legs[0].token;
        uint256 amt = seeder.seedOf(1).legs[0].amount;
        vm.prank(alice);
        safe.exec(address(acc), 0, abi.encodeCall(ERC6551.execute, (token, 0, abi.encodeCall(IERC20.transfer, (alice, amt)), 0)));
        assertEq(IERC20(token).balanceOf(alice), amt);
        // and the smart wallet can delegate an agent too
        vm.prank(alice);
        safe.exec(
            address(acc),
            0,
            abi.encodeCall(
                NeonFaceAccount.setAgent,
                (agent, uint64(block.timestamp + 1 days), _perms1(address(router), MockRouter.ping.selector), 0)
            )
        );
        vm.prank(agent);
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
        assertEq(router.pings(), 1);
    }

    function test_Holder_SignerChecks() public view {
        assertEq(acc.isValidSigner(alice, ""), bytes4(0x523e3260));
        assertEq(acc.isValidSigner(agent, ""), bytes4(0));
    }

    // =====================================================================
    // Agent: scoped execution
    // =====================================================================
    function test_Agent_CanOnlyCallAllowed() public {
        _delegate(_perms1(address(router), MockRouter.ping.selector), 0);
        vm.prank(agent);
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
        assertEq(router.pings(), 1);

        address token = seeder.seedOf(1).legs[0].token;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AgentCallNotAllowed.selector, token, IERC20.transfer.selector));
        acc.executeAsAgent(token, 0, abi.encodeCall(IERC20.transfer, (agent, 1)));

        vm.prank(agent); // not a signer: the holder API is closed to it
        vm.expectRevert(ERC6551.Unauthorized.selector);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (agent, 1)), 0);

        vm.prank(bob); // a stranger is not the agent
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
    }

    function test_Agent_BatchApproveAndSwap_AssetsStayInTheFace() public {
        tsla.mint(address(acc), 5e18);
        NeonFaceAccount.Permission[] memory p = new NeonFaceAccount.Permission[](2);
        p[0] = NeonFaceAccount.Permission(address(tsla), IERC20.approve.selector);
        p[1] = NeonFaceAccount.Permission(address(router), MockRouter.swap.selector);
        _delegate(p, 0);

        ERC6551.Call[] memory calls = new ERC6551.Call[](2);
        calls[0] = ERC6551.Call(address(tsla), 0, abi.encodeCall(IERC20.approve, (address(router), 1e18)));
        calls[1] = ERC6551.Call(address(router), 0, abi.encodeCall(MockRouter.swap, (address(tsla), address(usdg), 1e18)));
        uint256 tslaBefore = tsla.balanceOf(address(acc));
        vm.prank(agent);
        acc.executeBatchAsAgent(calls);
        assertEq(tsla.balanceOf(address(acc)), tslaBefore - 1e18);
        assertEq(usdg.balanceOf(address(acc)), 1e18);
        assertEq(tsla.balanceOf(agent) + usdg.balanceOf(agent), 0, "nothing reached the agent");
    }

    function test_Agent_BatchIsAtomic() public {
        _delegate(_perms1(address(router), MockRouter.ping.selector), 0);
        ERC6551.Call[] memory calls = new ERC6551.Call[](2);
        calls[0] = ERC6551.Call(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
        calls[1] = ERC6551.Call(address(tsla), 0, abi.encodeCall(IERC20.transfer, (agent, 1)));
        vm.prank(agent);
        vm.expectRevert();
        acc.executeBatchAsAgent(calls);
        assertEq(router.pings(), 0, "first call rolled back");
    }

    function test_Agent_SpendsEthOnlyWithinAllowance() public {
        vm.deal(address(acc), 1 ether);
        _delegate(_perms1(address(router), MockRouter.buyWithETH.selector), 0.3 ether);

        vm.prank(agent);
        acc.executeAsAgent(address(router), 0.2 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));
        assertEq(usdg.balanceOf(address(acc)), 0.2 ether);
        (,,,, uint256 left) = acc.agentConfig();
        assertEq(left, 0.1 ether);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AgentValueExceeded.selector, 0.2 ether, 0.1 ether));
        acc.executeAsAgent(address(router), 0.2 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));

        vm.prank(alice);
        acc.setAgentValueAllowance(0.5 ether);
        vm.prank(agent);
        acc.executeAsAgent(address(router), 0.2 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));
        assertEq(address(acc).balance, 0.6 ether);
    }

    function test_Agent_IncrementalPermissions() public {
        _delegate(_perms1(address(router), MockRouter.ping.selector), 0);
        NeonFaceAccount.Permission[] memory more = _perms1(address(router), MockRouter.buyWithETH.selector);
        vm.prank(alice);
        acc.setAgentPermissions(more, true);
        assertTrue(acc.isAgentCallAllowed(address(router), MockRouter.buyWithETH.selector));
        assertTrue(acc.isAgentCallAllowed(address(router), MockRouter.ping.selector));

        vm.prank(alice);
        acc.setAgentPermissions(_perms1(address(router), MockRouter.ping.selector), false);
        assertFalse(acc.isAgentCallAllowed(address(router), MockRouter.ping.selector));
        vm.prank(agent);
        vm.expectRevert();
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
    }

    function test_Agent_CannotTargetTheAccount() public {
        vm.prank(alice);
        vm.expectRevert(NeonFaceAccount.InvalidAgentConfig.selector);
        acc.setAgent(agent, uint64(block.timestamp + 1 days), _perms1(address(acc), NeonFaceAccount.lock.selector), 0);
    }

    function test_Agent_OnlyHolderConfigures() public {
        vm.prank(agent);
        vm.expectRevert(ERC6551.Unauthorized.selector);
        acc.setAgent(agent, uint64(block.timestamp + 1 days), _perms1(address(router), MockRouter.ping.selector), 1 ether);
    }

    function test_Agent_ExpiresAndRevokes() public {
        _delegate(_perms1(address(router), MockRouter.ping.selector), 0);
        vm.warp(block.timestamp + 31 days);
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));

        _delegate(new NeonFaceAccount.Permission[](0), 0); // new epoch: old permissions wiped
        vm.prank(agent);
        vm.expectRevert();
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));

        vm.prank(alice);
        acc.revokeAgent();
        (,,, bool active,) = acc.agentConfig();
        assertFalse(active);
    }

    function test_Agent_DiesOnSale_NewHolderStartsClean() public {
        vm.deal(address(acc), 1 ether);
        _delegate(_perms1(address(router), MockRouter.buyWithETH.selector), 1 ether);
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);

        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), 0.1 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));

        // bob delegates his own agent; nothing of alice's configuration carries over
        address bobAgent = makeAddr("bobAgent");
        vm.prank(bob);
        acc.setAgent(bobAgent, uint64(block.timestamp + 1 days), _perms1(address(router), MockRouter.ping.selector), 0);
        assertFalse(acc.isAgentCallAllowed(address(router), MockRouter.buyWithETH.selector));
        vm.prank(bobAgent);
        acc.executeAsAgent(address(router), 0, abi.encodeCall(MockRouter.ping, ()));
        assertEq(router.pings(), 1);
    }

    // =====================================================================
    // Lock: buyer protection
    // =====================================================================
    function test_Lock_BlocksEveryWayOut() public {
        vm.deal(address(acc), 1 ether);
        _delegate(_perms1(address(router), MockRouter.buyWithETH.selector), 1 ether);
        uint64 until = uint64(block.timestamp + 7 days);
        vm.prank(alice);
        acc.lock(until);
        assertTrue(acc.isLocked());

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AccountIsLocked.selector, until));
        acc.execute(alice, 1 ether, "", 0);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AccountIsLocked.selector, until));
        acc.executeBatch(new ERC6551.Call[](0), 0);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AccountIsLocked.selector, until));
        acc.setAgent(agent, until, new NeonFaceAccount.Permission[](0), 0);
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AccountIsLocked.selector, until));
        acc.executeAsAgent(address(router), 0.1 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));

        assertEq(acc.isValidSignature(bytes32(uint256(1)), hex"00"), bytes4(0xffffffff), "no signatures while locked");
        assertEq(acc.isValidSigner(alice, ""), bytes4(0));

        // receiving still works, and revoking an agent is always allowed
        tsla.mint(address(acc), 1e18);
        vm.prank(alice);
        acc.revokeAgent();

        vm.warp(until);
        vm.prank(alice);
        acc.execute(alice, 0.5 ether, "", 0);
    }

    function test_Lock_SurvivesSale_FrontRunFails() public {
        address token = seeder.seedOf(1).legs[0].token;
        uint256 amt = seeder.seedOf(1).legs[0].amount;
        vm.prank(alice);
        acc.lock(uint64(block.timestamp + 3 days)); // listed with a lock

        // the seller tries to drain right before the sale executes
        vm.prank(alice);
        vm.expectRevert();
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (alice, amt)), 0);

        vm.prank(alice);
        faces.transferFrom(alice, bob, 1); // sale
        assertEq(IERC20(token).balanceOf(address(acc)), amt, "buyer received the full contents");

        vm.warp(block.timestamp + 3 days);
        vm.prank(bob);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (bob, amt)), 0);
        assertEq(IERC20(token).balanceOf(bob), amt);
    }

    function test_Lock_Rules() public {
        vm.startPrank(alice);
        vm.expectRevert(NeonFaceAccount.InvalidLock.selector);
        acc.lock(uint64(block.timestamp)); // not in the past/now
        vm.expectRevert(NeonFaceAccount.InvalidLock.selector);
        acc.lock(uint64(block.timestamp + 366 days)); // max 365 days
        acc.lock(uint64(block.timestamp + 10 days));
        vm.expectRevert(NeonFaceAccount.InvalidLock.selector);
        acc.lock(uint64(block.timestamp + 5 days)); // can't shorten
        acc.lock(uint64(block.timestamp + 20 days)); // can extend
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ERC6551.Unauthorized.selector);
        acc.lock(uint64(block.timestamp + 30 days));
    }

    // =====================================================================
    // Full lifecycle after mint
    // =====================================================================
    function test_Lifecycle_MintDelegateSellRevealUpgrade() public {
        // 1. minted with a base seed
        NeonSeeder.SeedView memory s = seeder.seedOf(1);
        assertTrue(s.funded);
        // 2. holder funds the Face and delegates an agent with an ETH budget
        vm.deal(address(acc), 1 ether);
        _delegate(_perms1(address(router), MockRouter.buyWithETH.selector), 0.5 ether);
        vm.prank(agent);
        acc.executeAsAgent(address(router), 0.25 ether, abi.encodeCall(MockRouter.buyWithETH, (address(usdg))));
        // 3. holder locks and sells; agent dies with the sale
        vm.prank(alice);
        acc.lock(uint64(block.timestamp + 1 days));
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        (,,, bool active,) = acc.agentConfig();
        assertFalse(active);
        assertEq(faces.unblinkingFor(1), 0);
        // 4. sale closes, reveal, top-ups for Watch / Heavy Stare
        vm.prank(admin);
        faces.requestReveal();
        vm.roll(block.number + 6);
        faces.reveal();
        uint8 tier = seeder.tierOf(1);
        assertGt(tier, 0);
        uint256[] memory ids = new uint256[](2);
        (ids[0], ids[1]) = (1, 2);
        seeder.upgradeBatch(ids);
        assertEq(seeder.seedOf(1).upgraded, tier >= 2);
        // 5. the new holder uses the Face with everything inside
        vm.warp(block.timestamp + 1 days);
        uint256 usdgIn = usdg.balanceOf(address(acc));
        vm.prank(bob);
        acc.execute(address(usdg), 0, abi.encodeCall(IERC20.transfer, (bob, usdgIn)), 0);
        assertEq(usdg.balanceOf(bob), usdgIn);
        assertEq(address(acc).balance, 0.75 ether);
    }
}
