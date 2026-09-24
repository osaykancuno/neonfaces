// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {ERC6551} from "solady/accounts/ERC6551.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NeonFacesTest is Base {
    // ------------------------------------------------------------------
    // Mint flow: NFT + account + seed in one transaction
    // ------------------------------------------------------------------
    function test_PublicMint_CreatesAccountAndSeeds() public {
        _openPublic();
        uint256 first = _mintPublic(alice, 3);
        assertEq(first, 1);
        assertEq(faces.totalSupply(), 3);

        for (uint256 id = 1; id <= 3; ++id) {
            assertEq(faces.ownerOf(id), alice);
            NeonSeeder.SeedView memory s = seeder.seedOf(id);
            assertTrue(s.activated);
            assertTrue(s.funded);
            assertGt(s.account.code.length, 0, "account deployed");
            assertEq(s.account, registry.account(address(accountImpl), bytes32(0), block.chainid, address(faces), id));
            assertEq(NeonFaceAccount(payable(s.account)).owner(), alice);
            for (uint256 j; j < s.legs.length; ++j) {
                assertEq(IERC20(s.legs[j].token).balanceOf(s.account), s.legs[j].amount);
            }
        }
        assertEq(seeder.fundedCount(), 3);
        assertEq(address(minter).balance, PUBLIC_PRICE * 3);
    }

    function test_Mint_RevertsWhenClosed() public {
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(NeonMinter.SaleNotActive.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);
    }

    function test_Mint_WrongPayment() public {
        _openPublic();
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonMinter.WrongPayment.selector, uint256(PUBLIC_PRICE) * 2));
        minter.mint{value: PUBLIC_PRICE}(2, 0, proof);
    }

    function test_Mint_WalletLimitAndMaxPerTx() public {
        _openPublic();
        _mintPublic(alice, 5);
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(NeonMinter.WalletLimit.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);

        vm.prank(admin);
        minter.configurePhase(NeonMinter.Phase.Public, PUBLIC_PRICE, 50, 0, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(NeonMinter.InvalidQuantity.selector);
        minter.mint{value: PUBLIC_PRICE * 11}(11, 0, proof);
    }

    function test_Mint_PausedBlocksMintButNotTransfers() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(admin);
        faces.setMintPaused(true);

        bytes32[] memory proof;
        vm.prank(bob);
        vm.expectRevert(NeonFaces.MintIsPaused.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);

        vm.prank(alice);
        faces.transferFrom(alice, bob, 1); // secondary market is never paused
        assertEq(faces.ownerOf(1), bob);
    }

    function test_OnlyMinterCanMint() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, faces.MINTER_ROLE())
        );
        vm.prank(alice);
        faces.mint(alice, 1);
    }

    // ------------------------------------------------------------------
    // Allowlists (Merkle, allowance in leaf)
    // ------------------------------------------------------------------
    function test_BuildersPhase_FreeMintWithProof() public {
        bytes32 la = _leaf(alice, 2);
        bytes32 lb = _leaf(bob, 1);
        bytes32 root = _hashPair(la, lb);
        vm.startPrank(admin);
        minter.configurePhase(NeonMinter.Phase.Builders, 0, 0, 1111, root);
        minter.setPhase(NeonMinter.Phase.Builders);
        vm.stopPrank();

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        minter.mint(2, 2, proofA);
        assertEq(faces.balanceOf(alice), 2);

        // over allowance
        vm.prank(alice);
        vm.expectRevert(NeonMinter.WalletLimit.selector);
        minter.mint(1, 2, proofA);

        // forged allowance
        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = la;
        vm.prank(bob);
        vm.expectRevert(NeonMinter.NotAllowlisted.selector);
        minter.mint(2, 5, proofB);

        // not on list
        vm.prank(carol);
        vm.expectRevert(NeonMinter.NotAllowlisted.selector);
        minter.mint(1, 1, proofB);

        vm.prank(bob);
        minter.mint(1, 1, proofB);
        assertEq(faces.balanceOf(bob), 1);
    }

    function test_PhaseSupplyCap() public {
        bytes32 la = _leaf(alice, 5);
        bytes32 lb = _leaf(bob, 5);
        vm.startPrank(admin);
        minter.configurePhase(NeonMinter.Phase.Allowlist, AL_PRICE, 0, 6, _hashPair(la, lb));
        minter.setPhase(NeonMinter.Phase.Allowlist);
        vm.stopPrank();
        bytes32[] memory pa = new bytes32[](1);
        pa[0] = lb;
        bytes32[] memory pb = new bytes32[](1);
        pb[0] = la;
        vm.prank(alice);
        minter.mint{value: AL_PRICE * 5}(5, 5, pa);
        vm.prank(bob);
        vm.expectRevert(NeonMinter.PhaseSoldOut.selector);
        minter.mint{value: AL_PRICE * 2}(2, 5, pb);
        vm.prank(bob);
        minter.mint{value: AL_PRICE}(1, 5, pb);
    }

    function test_FinishedIsTerminal() public {
        vm.startPrank(admin);
        minter.setPhase(NeonMinter.Phase.Finished);
        vm.expectRevert(NeonMinter.PhaseFinished.selector);
        minter.setPhase(NeonMinter.Phase.Public);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Supply caps in bytecode
    // ------------------------------------------------------------------
    function test_TeamMintCappedAt111() public {
        vm.startPrank(admin);
        faces.teamMint(admin, 100);
        faces.teamMint(admin, 11);
        vm.expectRevert(NeonFaces.ExceedsTeamAllocation.selector);
        faces.teamMint(admin, 1);
        vm.stopPrank();
        assertEq(faces.teamMinted(), 111);

        // team faces are activated permissionlessly
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 111;
        vm.prank(carol);
        seeder.activateBatch(ids);
        assertTrue(seeder.seedOf(111).funded);
    }

    function test_PublicCapReservesTeamAllocation() public {
        bytes32 role = faces.MINTER_ROLE();
        vm.prank(admin);
        faces.grantRole(role, address(this));
        for (uint256 i; i < 54; ++i) faces.mint(alice, 100);
        faces.mint(alice, 44);
        assertEq(faces.publicMinted(), 5444);
        vm.expectRevert(NeonFaces.ExceedsPublicAllocation.selector);
        faces.mint(alice, 1);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        assertEq(faces.totalSupply(), faces.MAX_SUPPLY());
    }

    // ------------------------------------------------------------------
    // Seeds: exact urn, pending seeds, compliance-blocked tokens
    // ------------------------------------------------------------------
    function test_Urn_ExactTierCountsOverFullSupply() public {
        bytes32 role = faces.MINTER_ROLE();
        vm.prank(admin);
        faces.grantRole(role, address(this));
        for (uint256 i; i < 54; ++i) faces.mint(alice, 100);
        faces.mint(alice, 44);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        // don't fund (keeps the test fast and exercises the pending path)
        vm.startPrank(admin);
        seeder.setTierBaskets(1, new uint32[](0));
        seeder.setTierBaskets(2, new uint32[](0));
        seeder.setTierBaskets(3, new uint32[](0));
        vm.stopPrank();
        for (uint256 id = 1; id <= 5555; ++id) {
            if (id % 97 == 0) vm.roll(block.number + 1);
            seeder.activate(id);
        }
        assertEq(seeder.tierAssigned(1), 4444);
        assertEq(seeder.tierAssigned(2), 833);
        assertEq(seeder.tierAssigned(3), 278);
        assertEq(seeder.activatedCount(), 5555);
    }

    function test_PendingSeed_WhenPoolEmpty_ThenFund() public {
        vm.startPrank(admin);
        seeder.withdrawPool(address(tsla), admin, tsla.balanceOf(address(seeder)));
        seeder.withdrawPool(address(nvda), admin, nvda.balanceOf(address(seeder)));
        seeder.withdrawPool(address(spy), admin, spy.balanceOf(address(seeder)));
        vm.stopPrank();

        _openPublic();
        _mintPublic(alice, 2); // mint must not revert
        NeonSeeder.SeedView memory s = seeder.seedOf(1);
        assertTrue(s.activated);
        assertFalse(s.funded);

        tsla.mint(address(seeder), 10e18);
        nvda.mint(address(seeder), 10e18);
        spy.mint(address(seeder), 10e18);
        vm.prank(carol);
        seeder.fund(1);
        assertTrue(seeder.seedOf(1).funded);

        vm.expectRevert(NeonSeeder.AlreadyFunded.selector);
        seeder.fund(1);
    }

    function test_ComplianceBlockedToken_DoesNotBreakMint() public {
        tsla.setRestricted(true);
        nvda.setRestricted(true);
        spy.setRestricted(true);
        _openPublic();
        _mintPublic(alice, 3);
        assertEq(faces.balanceOf(alice), 3);
        assertEq(seeder.fundedCount(), 0);
    }

    function test_Seeder_ConfigLock() public {
        vm.prank(admin);
        seeder.lockConfig();
        vm.prank(admin);
        vm.expectRevert(NeonSeeder.ConfigIsLocked.selector);
        seeder.setBasket(1, _legs1(address(tsla), 1));
    }

    function test_Seeder_FundFromSelfOnlySelf() public {
        vm.expectRevert(NeonSeeder.OnlySelf.selector);
        seeder.fundFromSelf(1, alice);
    }

    function test_Activate_NonexistentReverts() public {
        vm.expectRevert();
        seeder.activate(42);
    }

    function test_Activate_Idempotent() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonSeeder.SeedView memory before = seeder.seedOf(1);
        uint256 bal = tsla.balanceOf(address(seeder)) + nvda.balanceOf(address(seeder));
        seeder.activate(1);
        NeonSeeder.SeedView memory afterV = seeder.seedOf(1);
        assertEq(afterV.tier, before.tier);
        assertEq(afterV.tierIndex, before.tierIndex);
        assertEq(tsla.balanceOf(address(seeder)) + nvda.balanceOf(address(seeder)), bal, "no double funding");
    }

    // ------------------------------------------------------------------
    // The Face account (ERC-6551)
    // ------------------------------------------------------------------
    function test_Account_FollowsTheFace() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonSeeder.SeedView memory s = seeder.seedOf(1);
        NeonFaceAccount acc = NeonFaceAccount(payable(s.account));
        address token = s.legs[0].token;
        uint256 amount = s.legs[0].amount;

        // holder can move the seed out
        vm.prank(alice);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (alice, amount / 2)), 0);
        assertEq(IERC20(token).balanceOf(alice), amount / 2);

        // sell the face: the wallet goes with it
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert(ERC6551.Unauthorized.selector);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (alice, 1)), 0);

        vm.prank(bob);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (bob, amount / 2)), 0);
        assertEq(IERC20(token).balanceOf(bob), amount / 2);
    }

    function test_Account_ReceivesEthAndNfts() public {
        _openPublic();
        _mintPublic(alice, 2);
        address acc1 = seeder.accountOf(1);
        (bool ok,) = acc1.call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(alice);
        faces.safeTransferFrom(alice, acc1, 2); // a Face can hold another Face
        assertEq(faces.ownerOf(2), acc1);
    }

    function test_Account_CannotOwnItself() public {
        _openPublic();
        _mintPublic(alice, 1);
        address acc1 = seeder.accountOf(1);
        vm.prank(alice);
        vm.expectRevert(ERC6551.SelfOwnDetected.selector);
        faces.safeTransferFrom(alice, acc1, 1);
    }

    function test_Account_NotUpgradeable() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonFaceAccount acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        vm.prank(alice);
        vm.expectRevert();
        acc.upgradeToAndCall(address(0xdead), "");
    }

    // ------------------------------------------------------------------
    // Agent delegation
    // ------------------------------------------------------------------
    function _agentSetup() internal returns (NeonFaceAccount acc, MockRouter router, address agent) {
        _openPublic();
        _mintPublic(alice, 1);
        acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        router = new MockRouter();
        agent = makeAddr("agent");
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](1);
        perms[0] = NeonFaceAccount.Permission(address(router), MockRouter.ping.selector);
        vm.prank(alice);
        acc.setAgent(agent, uint64(block.timestamp + 7 days), perms);
    }

    function test_Agent_CanOnlyCallAllowed() public {
        (NeonFaceAccount acc, MockRouter router, address agent) = _agentSetup();
        vm.prank(agent);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.ping, ()));
        assertEq(router.pings(), 1);

        // not allowed: token transfer out of the account
        address token = seeder.seedOf(1).legs[0].token;
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentCallNotAllowed.selector);
        acc.executeAsAgent(token, abi.encodeCall(IERC20.transfer, (agent, 1)));

        // agent is not a signer
        vm.prank(agent);
        vm.expectRevert(ERC6551.Unauthorized.selector);
        acc.execute(token, 0, abi.encodeCall(IERC20.transfer, (agent, 1)), 0);
        assertEq(acc.isValidSigner(agent, ""), bytes4(0));
    }

    function test_Agent_DiesWhenFaceIsSold() public {
        (NeonFaceAccount acc, MockRouter router, address agent) = _agentSetup();
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.ping, ()));
        (,,, bool active) = acc.agentConfig();
        assertFalse(active);
    }

    function test_Agent_ExpiresAndRevokes() public {
        (NeonFaceAccount acc, MockRouter router, address agent) = _agentSetup();
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.ping, ()));

        (acc, router, agent) = (acc, router, agent);
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](0);
        vm.prank(alice);
        acc.setAgent(agent, uint64(block.timestamp + 1 days), perms); // new epoch: old permissions wiped
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentCallNotAllowed.selector);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.ping, ()));

        vm.prank(alice);
        acc.revokeAgent();
        vm.prank(agent);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.ping, ()));
    }

    function test_Agent_CannotTargetSelf() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonFaceAccount acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](1);
        perms[0] = NeonFaceAccount.Permission(address(acc), NeonFaceAccount.setAgent.selector);
        vm.prank(alice);
        vm.expectRevert(NeonFaceAccount.InvalidAgentConfig.selector);
        acc.setAgent(makeAddr("agent"), uint64(block.timestamp + 1 days), perms);
    }

    function test_Agent_StrategyWithApprovedRouter() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonFaceAccount acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        MockRouter router = new MockRouter();
        usdg.mint(address(router), 1_000e6);
        tsla.mint(address(acc), 5e18);
        address agent = makeAddr("agent");

        // holder: approve the router once, then allow the agent to call router.swap only
        vm.startPrank(alice);
        acc.execute(address(tsla), 0, abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)), 0);
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](1);
        perms[0] = NeonFaceAccount.Permission(address(router), MockRouter.swap.selector);
        acc.setAgent(agent, uint64(block.timestamp + 30 days), perms);
        vm.stopPrank();

        // agent "takes profit" into USDG — assets never leave the Face account
        vm.prank(agent);
        acc.executeAsAgent(address(router), abi.encodeCall(MockRouter.swap, (address(tsla), address(usdg), 1e6)));
        assertEq(usdg.balanceOf(address(acc)), 1e6);
    }

    // ------------------------------------------------------------------
    // Provenance, reveal, metadata
    // ------------------------------------------------------------------
    function test_Provenance_OnceAndBeforeMint() public {
        vm.startPrank(admin);
        faces.setProvenanceHash(keccak256("art"));
        vm.expectRevert(NeonFaces.ProvenanceAlreadySet.selector);
        faces.setProvenanceHash(keccak256("other"));
        vm.stopPrank();
    }

    function test_Provenance_NotAfterMint() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(admin);
        vm.expectRevert(NeonFaces.MintAlreadyStarted.selector);
        faces.setProvenanceHash(keccak256("art"));
    }

    function test_Reveal_AndArtMappingIsABijectionPerTier() public {
        bytes32 role = faces.MINTER_ROLE();
        vm.prank(admin);
        faces.grantRole(role, address(this));
        faces.mint(alice, 300);
        for (uint256 id = 1; id <= 300; ++id) seeder.activate(id);

        assertEq(seeder.artIdOf(1), type(uint256).max); // unrevealed

        vm.prank(admin);
        faces.requestReveal();
        vm.expectRevert(NeonFaces.RevealTooEarly.selector);
        faces.reveal();
        vm.roll(block.number + 6);
        faces.reveal();
        assertTrue(faces.revealSeed() != 0);

        bool[] memory used = new bool[](5555);
        for (uint256 id = 1; id <= 300; ++id) {
            uint256 art = seeder.artIdOf(id);
            NeonSeeder.SeedView memory s = seeder.seedOf(id);
            if (s.tier == 1) assertLt(art, 4444);
            else if (s.tier == 2) assertTrue(art >= 4444 && art < 5277);
            else assertTrue(art >= 5277 && art < 5555);
            assertFalse(used[art], "art assigned twice");
            used[art] = true;
        }

        vm.expectRevert(NeonFaces.RevealAlreadyDone.selector);
        faces.reveal();
    }

    function test_TokenURI_UnrevealedThenBaseThenFrozen() public {
        _openPublic();
        _mintPublic(alice, 1);
        assertEq(faces.tokenURI(1), "ipfs://unrevealed.json");
        vm.startPrank(admin);
        faces.setBaseURI("ipfs://cid/");
        assertEq(faces.tokenURI(1), "ipfs://cid/1");
        faces.freezeMetadata();
        vm.expectRevert(NeonFaces.MetadataIsFrozen.selector);
        faces.setBaseURI("ipfs://evil/");
        vm.stopPrank();
    }

    function test_Royalty5PercentCapped() public {
        (address recv, uint256 amt) = faces.royaltyInfo(1, 1 ether);
        assertEq(recv, royaltyReceiver);
        assertEq(amt, 0.05 ether);
        vm.prank(admin);
        vm.expectRevert(NeonFaces.RoyaltyTooHigh.selector);
        faces.setDefaultRoyalty(royaltyReceiver, 501);
    }

    function test_SupportsInterfaces() public view {
        assertTrue(faces.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(faces.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(faces.supportsInterface(0x49064906)); // ERC4906
        assertEq(faces.owner(), admin); // OpenSea collection owner
    }

    // ------------------------------------------------------------------
    // Proceeds split 40 / 25 / 20 / 15 + team vesting
    // ------------------------------------------------------------------
    function test_Split_ReleaseAll() public {
        _openPublic();
        _mintPublic(alice, 5);
        _mintPublic(bob, 5);
        uint256 total = PUBLIC_PRICE * 10;

        vm.prank(carol); // anyone can push
        minter.releaseAll();
        assertEq(seedVault.balance, total * 40 / 100);
        assertEq(treasury.balance, total * 25 / 100);
        assertEq(address(teamVesting).balance, total * 20 / 100);
        assertEq(growth.balance, total * 15 / 100);
        assertEq(address(minter).balance, 0);

        // more sales later: shares keep accruing correctly
        _mintPublic(carol, 1);
        minter.release(seedVault);
        assertEq(seedVault.balance, (total + PUBLIC_PRICE) * 40 / 100);
        assertEq(minter.releasable(treasury), uint256(PUBLIC_PRICE) * 25 / 100);
        assertEq(minter.releasable(alice), 0);
    }

    function test_TeamVesting_Linear6Months() public {
        _openPublic();
        _mintPublic(alice, 5);
        minter.releaseAll();
        uint256 teamTotal = address(teamVesting).balance;
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertApproxEqAbs(teamBeneficiary.balance, teamTotal / 2, 1);
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertEq(teamBeneficiary.balance, teamTotal);
    }

    function test_Minter_RejectsDuplicatePayees() public {
        vm.expectRevert(NeonMinter.DuplicatePayee.selector);
        new NeonMinter(faces, seeder, admin, seedVault, seedVault, growth, treasury);
    }
}
