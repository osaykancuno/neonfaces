// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonSeedVault} from "../src/NeonSeedVault.sol";
import {NeonTrader} from "../src/NeonTrader.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {ERC6551} from "solady/accounts/ERC6551.sol";
import {NeonPayout} from "../src/NeonPayout.sol";
import {NeonSetVotes} from "../src/NeonSetVotes.sol";
import {MintParams, SignedMintValidationParams, PublicDrop} from "../src/interfaces/ISeaDrop.sol";

interface ISeaDropMint {
    function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)
        external
        payable;
    function mintSigned(
        address nftContract,
        address feeRecipient,
        address minterIfNotPayer,
        uint256 quantity,
        MintParams calldata mintParams,
        uint256 salt,
        bytes calldata signature
    ) external payable;
    function getSignedMintValidationParams(address nftContract, address signer)
        external
        view
        returns (SignedMintValidationParams memory);
}

interface IFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice The whole holder journey against the DEPLOYED mainnet contracts, on a fork of the current state:
/// the list stage (server-signed, as OpenSea Studio set it), the public stage, seeds, the Face account, agents,
/// a transfer, the team mint, the reveal, top-ups, sets (assemble, bonus, fuse, vote) and the payout split.
/// Run against a local anvil fork of mainnet: forge test --match-contract LiveJourney --fork-url http://127.0.0.1:8549 -vv
contract LiveJourneyTest is Test {
    NeonFaces constant FACES = NeonFaces(0x67384d956ac12f2C4a69167BF0DC67A3F72C1C1B);
    NeonSeeder constant SEEDER = NeonSeeder(0xe00EAaC0ab3312dDB59069130D422ea8f09Cfc1E);
    NeonSeedVault constant VAULT = NeonSeedVault(payable(0xf39034C97F1f0B5f3b2b527717f8442D9c08A2b4));
    NeonTrader constant TRADER = NeonTrader(0x93C02C45890616B2c63435E7E97Fb8B788B73610);
    NeonPayout constant PAYOUT = NeonPayout(payable(0xa5535d620800C4C6d44bbd1d73b8B7C30CFC5958));
    NeonSetVotes constant VOTES = NeonSetVotes(0xBD606C4f3BFA0A9d71A1e54EedD45c64A9d7D90d);
    ISeaDropMint constant SEADROP = ISeaDropMint(0x00005EA00Ac477B1030CE78506496e8C2dE24bf5);
    address constant SAFE = 0x2388BB366bfEaF15d1D01C0e33660b6497FB0bE1;
    address constant SALE_MANAGER = 0x70Ad3dA485fD66F0986f465457AE804Bb11EFb99;
    address constant KEEPER = 0x3a64Fc7fBC9656613342721D9dCb99fB9ac61627;
    address constant OS_FEE = 0x0000a26b00c1F0DF003000390027140000fAa719;
    address constant OS_SIGNER = 0xfCe4b31128100915f2980BBC3a08894Ee5e8F8C3;
    uint256 constant LIST_START = 1790877600; // Thu 1 Oct 2026 18:00 UTC
    uint256 constant LIST_END = 1790964000;
    uint256 constant PUBLIC_START = 1790964000; // Fri 2 Oct 18:00 UTC

    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant CBBTC = 0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;

    address[] tokens;
    mapping(address => uint24) feeOf;
    address[] feeds;

    uint256 signerKey = 0xA11CE;
    address signer;
    address alice = makeAddr("alice"); // on the list
    address bob = makeAddr("bob"); // public only, then buys Alice's Face
    address whaleHolder = makeAddr("collector"); // many Faces, for sets
    address agent = makeAddr("agent");

    function setUp() public {
        if (block.chainid != 4663) return;
        _tok(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 3000, 0x4A1166a659A55625345e9515b32adECea5547C38); // TSLA
        _tok(NVDA, 500, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15);
        _tok(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 500, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0); // AAPL
        _tok(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 3000, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C); // AMZN
        _tok(0xe93237C50D904957Cf27E7B1133b510C669c2e74, 3000, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E); // MSFT
        _tok(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 500, 0xF6f373a037c30F0e5010d854385cA89185AE638b); // GOOGL
        _tok(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 3000, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1); // META
        _tok(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 500, 0x319724394D3A0e3669269846abE664Cd621f9f6A); // SPY
        _tok(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 500, 0x80901d846d5D7B030F26B480776EE3b29374C2ae); // QQQ
        _tok(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 3000, 0x209b73908e92Ae021826eD79609845451Ecba2ce); // SLV
        _tok(0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e, 3000, 0x470A51258068043bd43dC0a56245625C9fE86eB0); // GLD
        _tok(CBBTC, 3000, 0x0009cD492adf8167f9eEBf1293556A673530a21a);
        _tok(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 500, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb); // SPCX
        _tok(USDG, 100, 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2);
        feeds.push(0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9); // ETH/USD
        signer = vm.addr(signerKey);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _tok(address t, uint24 fee, address feed) internal {
        tokens.push(t);
        feeOf[t] = fee;
        feeds.push(feed);
    }

    /// @dev Chainlink keeps updating in real life; on a fork moved forward in time, re-date the current answers.
    function _freshFeeds() internal {
        for (uint256 i; i < feeds.length; ++i) {
            (uint80 r, int256 a,,,) = IFeed(feeds[i]).latestRoundData();
            vm.mockCall(
                feeds[i],
                abi.encodeWithSelector(IFeed.latestRoundData.selector),
                abi.encode(r, a, block.timestamp, block.timestamp, r)
            );
        }
    }

    function _route(address t) internal view returns (address[] memory path, uint24[] memory fees) {
        if (t == USDG) {
            path = new address[](2);
            fees = new uint24[](1);
            (path[0], path[1], fees[0]) = (WETH, USDG, 100);
        } else if (t == CBBTC) {
            path = new address[](2);
            fees = new uint24[](1);
            (path[0], path[1], fees[0]) = (WETH, CBBTC, 3000);
        } else {
            path = new address[](3);
            fees = new uint24[](2);
            (path[0], path[1], path[2], fees[0], fees[1]) = (WETH, USDG, t, 100, feeOf[t]);
        }
    }

    function _allRoutes() internal view returns (address[][] memory paths, uint24[][] memory fees) {
        paths = new address[][](tokens.length);
        fees = new uint24[][](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            (paths[i], fees[i]) = _route(tokens[i]);
        }
    }

    function _signed(address minter, uint256 qty, uint256 salt) internal view returns (MintParams memory p, bytes memory sig) {
        p = MintParams(0.013 ether, 3, LIST_START, LIST_END, 1, 5444, 1000, true);
        bytes32 mintParamsHash = keccak256(
            abi.encode(
                keccak256(
                    "MintParams(uint256 mintPrice,uint256 maxTotalMintableByWallet,uint256 startTime,uint256 endTime,uint256 dropStageIndex,uint256 maxTokenSupplyForStage,uint256 feeBps,bool restrictFeeRecipients)"
                ),
                p.mintPrice, p.maxTotalMintableByWallet, p.startTime, p.endTime, p.dropStageIndex,
                p.maxTokenSupplyForStage, p.feeBps, p.restrictFeeRecipients
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "SignedMint(address nftContract,address minter,address feeRecipient,MintParams mintParams,uint256 salt)MintParams(uint256 mintPrice,uint256 maxTotalMintableByWallet,uint256 startTime,uint256 endTime,uint256 dropStageIndex,uint256 maxTokenSupplyForStage,uint256 feeBps,bool restrictFeeRecipients)"
                ),
                address(FACES), minter, OS_FEE, mintParamsHash, salt
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SeaDrop"), keccak256("1.0"), block.chainid, address(SEADROP)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        sig = abi.encodePacked(r, s, v);
        qty;
    }

    function test_LiveJourney() public {
        if (block.chainid != 4663) {
            console2.log("skipped: run with --fork-url of Robinhood Chain mainnet");
            return;
        }
        assertEq(FACES.totalSupply(), 0, "fresh: nothing minted yet");
        _listStage();
        _seedsAndAccount();
        _agentAndResale();
        _publicStage();
        _massMintTeamAndReveal();
        _topUps();
        _sets();
        _payoutAndGuards();
    }

    function _listStage() internal {
        // Studio's signer, as configured on-chain; a test signer with the SAME validation params stands in for
        // OpenSea's server (only it holds the real key)
        SignedMintValidationParams memory v = SEADROP.getSignedMintValidationParams(address(FACES), OS_SIGNER);
        assertEq(v.minStartTime, LIST_START, "list opens Thu 18:00 UTC");
        vm.prank(SALE_MANAGER);
        FACES.updateSignedMintValidationParams(address(SEADROP), signer, v);

        (MintParams memory p, bytes memory sig) = _signed(alice, 3, 1);
        vm.warp(LIST_START - 60);
        vm.prank(alice);
        vm.expectRevert(); // not open yet
        SEADROP.mintSigned{value: 0.039 ether}(address(FACES), OS_FEE, address(0), 3, p, 1, sig);

        vm.warp(LIST_START + 5);
        _freshFeeds();
        // public is still closed during the list
        vm.prank(bob);
        vm.expectRevert();
        SEADROP.mintPublic{value: 0.018 ether}(address(FACES), OS_FEE, address(0), 1);

        uint256 osBefore = OS_FEE.balance;
        uint256 payoutBefore = address(PAYOUT).balance;
        vm.prank(alice);
        SEADROP.mintSigned{value: 0.039 ether}(address(FACES), OS_FEE, address(0), 3, p, 1, sig);
        assertEq(FACES.balanceOf(alice), 3, "alice minted 3 on the list");
        assertEq(OS_FEE.balance - osBefore, 0.0039 ether, "OpenSea 10%");
        assertEq(address(PAYOUT).balance - payoutBefore, 0.0351 ether, "90% to NeonPayout");

        // a 4th on the list: over the 3 each
        (p, sig) = _signed(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert();
        SEADROP.mintSigned{value: 0.013 ether}(address(FACES), OS_FEE, address(0), 1, p, 2, sig);
        // underpaying
        (p, sig) = _signed(bob, 1, 3);
        vm.prank(bob);
        vm.expectRevert();
        SEADROP.mintSigned{value: 0.012 ether}(address(FACES), OS_FEE, address(0), 1, p, 3, sig);
        // a signature for alice used by bob
        (p, sig) = _signed(alice, 1, 4);
        vm.prank(bob);
        vm.expectRevert();
        SEADROP.mintSigned{value: 0.013 ether}(address(FACES), OS_FEE, address(0), 1, p, 4, sig);
        console2.log("list stage ok: 3 minted at 0.013, 4th/underpay/stolen signature refused");
    }

    function _seedsAndAccount() internal {
        // every Face is born with its account; the pool is empty, so the seed waits
        for (uint256 id = 1; id <= 3; ++id) {
            address acct = SEEDER.accountOf(id);
            assertGt(acct.code.length, 0, "account deployed at mint");
            NeonSeeder.SeedView memory s = SEEDER.seedOf(id);
            assertTrue(s.activated, "activated");
            assertFalse(s.funded, "pending: pool empty");
        }
        // the payout forwards the vault's 55% when anyone releases it
        PAYOUT.releaseAll();
        assertGt(address(VAULT).balance, 0, "vault funded by the sale");
        uint256 vaultEth = address(VAULT).balance;
        console2.log("vault ETH after 3 list mints (wei)", vaultEth);

        // the keeper's way: buy a token into the pool, then fund
        NeonSeeder.SeedView memory s1 = SEEDER.seedOf(1);
        s1;
        (address[] memory path, uint24[] memory fees) = _route(NVDA);
        vm.prank(KEEPER);
        VAULT.buy(path, fees, 0.002 ether, 100);
        assertGt(IERC20(NVDA).balanceOf(address(SEEDER)), 0, "keeper bought NVDA into the pool");

        // anyone's way (the site's button): restock what is owed and deliver in one tx
        (address[][] memory paths, uint24[][] memory fs) = _allRoutes();
        vm.deal(address(VAULT), address(VAULT).balance + 1 ether); // stands in for more sales
        for (uint256 id = 1; id <= 3; ++id) {
            if (!SEEDER.seedOf(id).funded) VAULT.restockAndDeliver(VAULT.DELIVER_SEED(), id, paths, fs);
            NeonSeeder.SeedView memory s = SEEDER.seedOf(id);
            assertTrue(s.funded, "seed delivered");
            IERC20 t = IERC20(s.legs[0].token);
            assertEq(t.balanceOf(s.account), s.legs[0].amount, "basket in the Face account");
        }
        console2.log("seeds ok: keeper buy + public restockAndDeliver; baskets in the accounts");

        // the holder moves tokens out of the Face and back
        NeonSeeder.SeedView memory a = SEEDER.seedOf(1);
        NeonFaceAccount acc = NeonFaceAccount(payable(a.account));
        IERC20 tok = IERC20(a.legs[0].token);
        uint256 amt = a.legs[0].amount;
        vm.prank(alice);
        acc.execute(address(tok), 0, abi.encodeCall(IERC20.transfer, (alice, amt / 2)), 0);
        assertEq(tok.balanceOf(alice), amt / 2, "holder withdrew half");
        vm.prank(bob);
        vm.expectRevert();
        acc.execute(address(tok), 0, abi.encodeCall(IERC20.transfer, (bob, 1)), 0);

        // the holder trades inside the Face through NeonTrader (daily cap, fair price)
        address[] memory p2 = new address[](2);
        uint24[] memory f2 = new uint24[](1);
        if (address(tok) == CBBTC) revert("unexpected base token");
        (p2[0], p2[1], f2[0]) = (address(tok), USDG, feeOf[address(tok)]);
        uint256 sell = tok.balanceOf(address(acc)) / 2;
        ERC6551.Call[] memory calls = new ERC6551.Call[](3);
        calls[0] = ERC6551.Call(address(TRADER), 0, abi.encodeCall(NeonTrader.setDailyLimit, (100e8)));
        calls[1] = ERC6551.Call(address(tok), 0, abi.encodeCall(IERC20.approve, (address(TRADER), sell)));
        calls[2] = ERC6551.Call(address(TRADER), 0, abi.encodeCall(NeonTrader.swap, (p2, f2, sell, 100)));
        vm.prank(alice);
        acc.executeBatch(calls, 0);
        assertGt(IERC20(USDG).balanceOf(address(acc)), 0, "swapped part of the basket to USDG");

        // lock: nothing leaves while locked
        vm.prank(alice);
        acc.lock(uint64(block.timestamp + 1 days));
        vm.prank(alice);
        vm.expectRevert();
        acc.execute(USDG, 0, abi.encodeCall(IERC20.transfer, (alice, 1)), 0);
        vm.warp(block.timestamp + 1 days + 1);
        _freshFeeds();
        console2.log("account ok: withdraw, trade via NeonTrader, lock; strangers refused");
    }

    function _agentAndResale() internal {
        NeonSeeder.SeedView memory a = SEEDER.seedOf(2);
        NeonFaceAccount acc = NeonFaceAccount(payable(a.account));
        IERC20 tok = IERC20(a.legs[0].token);
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](2);
        perms[0] = NeonFaceAccount.Permission(address(tok), IERC20.approve.selector);
        perms[1] = NeonFaceAccount.Permission(address(TRADER), NeonTrader.swap.selector);
        ERC6551.Call[] memory c = new ERC6551.Call[](1);
        c[0] = ERC6551.Call(address(TRADER), 0, abi.encodeCall(NeonTrader.setDailyLimit, (50e8)));
        vm.startPrank(alice);
        acc.executeBatch(c, 0);
        acc.setAgent(agent, uint64(block.timestamp + 7 days), perms, 0);
        vm.stopPrank();

        address[] memory p2 = new address[](2);
        uint24[] memory f2 = new uint24[](1);
        (p2[0], p2[1], f2[0]) = (address(tok), USDG, feeOf[address(tok)]);
        uint256 sell = tok.balanceOf(address(acc)) / 4;
        vm.startPrank(agent);
        acc.executeAsAgent(address(tok), 0, abi.encodeCall(IERC20.approve, (address(TRADER), sell)));
        acc.executeAsAgent(address(TRADER), 0, abi.encodeCall(NeonTrader.swap, (p2, f2, sell, 100)));
        vm.expectRevert(); // an agent can't take tokens out
        acc.executeAsAgent(address(tok), 0, abi.encodeCall(IERC20.transfer, (agent, 1)));
        vm.stopPrank();

        // alice sells Face #2 to bob: the account and its contents follow; the old agent is void
        vm.prank(alice);
        FACES.transferFrom(alice, bob, 2);
        vm.prank(agent);
        vm.expectRevert();
        acc.executeAsAgent(address(tok), 0, abi.encodeCall(IERC20.approve, (address(TRADER), 1)));
        vm.prank(alice);
        vm.expectRevert();
        acc.execute(address(tok), 0, abi.encodeCall(IERC20.transfer, (alice, 1)), 0);
        uint256 bal = tok.balanceOf(address(acc));
        vm.prank(bob);
        acc.execute(address(tok), 0, abi.encodeCall(IERC20.transfer, (bob, bal)), 0);
        assertEq(tok.balanceOf(bob), bal, "new holder controls the account");
        console2.log("agent ok (trades, can't withdraw); resale moves the account, voids the agent");
    }

    function _publicStage() internal {
        vm.warp(PUBLIC_START + 5);
        _freshFeeds();
        // alice (3 on the list) can take 2 more: 5 in total
        vm.prank(alice);
        SEADROP.mintPublic{value: 0.036 ether}(address(FACES), OS_FEE, address(0), 2);
        vm.prank(alice);
        vm.expectRevert();
        SEADROP.mintPublic{value: 0.018 ether}(address(FACES), OS_FEE, address(0), 1);
        // bob: 5 at 0.018
        vm.prank(bob);
        vm.expectRevert(); // underpaying
        SEADROP.mintPublic{value: 0.08 ether}(address(FACES), OS_FEE, address(0), 5);
        vm.prank(bob);
        vm.expectRevert(); // a fee recipient other than OpenSea's
        SEADROP.mintPublic{value: 0.09 ether}(address(FACES), bob, address(0), 5);
        vm.prank(bob);
        SEADROP.mintPublic{value: 0.09 ether}(address(FACES), OS_FEE, address(0), 5);
        assertEq(FACES.balanceOf(bob), 6, "bob: 5 minted + #2 bought");
        (uint256 minted,,) = FACES.getMintStats(alice);
        assertEq(minted, 5, "alice 5 in total");
        // the Safe can pause and resume in an emergency
        vm.prank(SAFE);
        FACES.setMintPaused(true);
        vm.prank(address(0xBEEF));
        vm.deal(address(0xBEEF), 1 ether);
        vm.expectRevert();
        SEADROP.mintPublic{value: 0.018 ether}(address(FACES), OS_FEE, address(0), 1);
        vm.prank(SAFE);
        FACES.setMintPaused(false);
        console2.log("public stage ok: 0.018, 5 in total across stages, OpenSea-only fee, pause works");
    }

    function _massMintTeamAndReveal() internal {
        // the rest of a sell-out, straight through SeaDrop's entry point (its checks were exercised above)
        uint256 left = 5444 - FACES.totalSupply();
        vm.startPrank(address(SEADROP));
        while (left > 0) {
            uint256 q = left > 200 ? 200 : left;
            FACES.mintSeaDrop(whaleHolder, q);
            left -= q;
        }
        vm.stopPrank();
        assertEq(FACES.totalSupply(), 5444, "sold out");
        vm.prank(address(SEADROP));
        vm.expectRevert();
        FACES.mintSeaDrop(bob, 1);

        // team mint BEFORE the reveal request
        vm.startPrank(SAFE);
        FACES.teamMint(SAFE, 50);
        FACES.teamMint(SAFE, 50);
        FACES.teamMint(SAFE, 11);
        vm.expectRevert();
        FACES.teamMint(SAFE, 1);
        FACES.requestReveal();
        vm.stopPrank();
        assertEq(FACES.totalSupply(), 5555);
        assertTrue(FACES.mintClosed(), "minting closed by the reveal request");
        vm.prank(SAFE);
        vm.expectRevert();
        FACES.teamMint(SAFE, 1);
        // reveal(): on mainnet the watcher calls it with the real L2 block hash; a fork can't serve arbBlockHash,
        // so set the seed the way reveal() would
        vm.store(address(FACES), bytes32(uint256(21)), keccak256(abi.encode(blockhash(block.number - 1), "reveal")));
        assertGt(FACES.revealSeed(), 0);
        uint256[4] memory c = SEEDER.tierCounts();
        console2.log("tiers Glance/Watch/Heavy", c[1], c[2], c[3]);
        assertEq(c[1] + c[2] + c[3], 5555);
        string memory uri = FACES.tokenURI(1);
        assertGt(bytes(uri).length, 1000, "on-chain tokenURI renders");
        console2.log("sell-out, team 111, reveal request, reveal seed, tokenURI ok");
    }

    function _topUps() internal {
        (address[][] memory paths, uint24[][] memory fs) = _allRoutes();
        vm.deal(address(VAULT), address(VAULT).balance + 30 ether); // the sale's 55%
        uint256 doneW;
        uint256 doneH;
        for (uint256 id = 1; id <= 5555 && (doneW == 0 || doneH == 0); ++id) {
            uint8 t = SEEDER.tierOf(id);
            if ((t == 2 && doneW == 0) || (t == 3 && doneH == 0)) {
                if (!SEEDER.seedOf(id).funded) VAULT.restockAndDeliver(VAULT.DELIVER_SEED(), id, paths, fs);
                VAULT.restockAndDeliver(VAULT.DELIVER_TOP_UP(), id, paths, fs);
                NeonSeeder.SeedView memory s = SEEDER.seedOf(id);
                assertTrue(s.upgraded, "top-up delivered");
                for (uint256 k; k < s.upgradeLegs.length; ++k) {
                    assertGe(IERC20(s.upgradeLegs[k].token).balanceOf(s.account), s.upgradeLegs[k].amount);
                }
                if (t == 2) doneW = id;
                else doneH = id;
            }
        }
        assertGt(doneW, 0);
        assertGt(doneH, 0);
        console2.log("top-ups ok: Watch #", doneW);
        console2.log("top-ups ok: Heavy Stare #", doneH);
    }

    function _sets() internal {
        // a set whose four pieces the collector holds
        uint256 anchor;
        uint256[4] memory m;
        for (uint256 id = 20; id <= 5444; ++id) {
            (uint256 setId, uint256 piece, uint256[4] memory members) = SEEDER.setOf(id);
            if (setId == 0 || piece != 0) continue;
            bool all = true;
            for (uint256 k; k < 4; ++k) {
                if (FACES.ownerOf(members[k]) != whaleHolder) all = false;
            }
            if (all && members[0] == id) {
                anchor = id;
                m = members;
                break;
            }
        }
        if (anchor == 0) {
            // piece numbering may not start at 0 for the anchor: take any fully held set and its first member
            for (uint256 id = 20; id <= 5444 && anchor == 0; ++id) {
                (uint256 setId,, uint256[4] memory members) = SEEDER.setOf(id);
                if (setId == 0) continue;
                bool all = true;
                for (uint256 k; k < 4; ++k) {
                    if (FACES.ownerOf(members[k]) != whaleHolder) all = false;
                }
                if (all) (anchor, m) = (members[0], members);
            }
        }
        assertGt(anchor, 0, "found a set");
        vm.prank(whaleHolder);
        FACES.assembleSet(anchor);
        assertTrue(SEEDER.isAssembled(anchor), "assembled");

        // the last piece moved in pays the bonus by itself when the pool holds it; otherwise anyone delivers it
        address acct = SEEDER.accountOf(anchor);
        (uint256 setId,,) = SEEDER.setOf(anchor);
        (uint32 paidAnchor,) = SEEDER.setBonus(setId);
        console2.log("bonus paid by the assembly itself", paidAnchor == anchor);
        if (paidAnchor == 0) {
            (address[][] memory paths, uint24[][] memory fs) = _allRoutes();
            VAULT.restockAndDeliver(VAULT.DELIVER_SET_BONUS(), anchor, paths, fs);
            (paidAnchor,) = SEEDER.setBonus(setId);
        }
        assertEq(paidAnchor, anchor, "set bonus paid");
        vm.expectRevert();
        SEEDER.claimSetBonus(anchor);

        // a vote of the sets (the Safe asks)
        string[] memory choices = new string[](2);
        choices[0] = "yes";
        choices[1] = "no";
        vm.prank(SAFE);
        uint256 pollId = VOTES.createPoll("Test?", choices, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        vm.prank(whaleHolder);
        VOTES.vote(pollId, anchor, 0);
        assertEq(VOTES.voteOf(pollId, setId), 0, "the set voted yes");

        // fuse: the pieces can't leave the anchor's account again
        vm.prank(whaleHolder);
        SEEDER.fuse(anchor);
        uint256 piece = m[0] == anchor ? m[1] : m[0];
        vm.prank(whaleHolder);
        vm.expectRevert();
        NeonFaceAccount(payable(acct)).execute(
            address(FACES), 0, abi.encodeWithSignature("transferFrom(address,address,uint256)", acct, whaleHolder, piece), 0
        );
        // the fused set changes hands whole
        vm.prank(whaleHolder);
        FACES.transferFrom(whaleHolder, bob, anchor);
        assertEq(FACES.ownerOf(piece), acct, "piece stays inside the anchor");
        assertGt(bytes(FACES.tokenURI(anchor)).length, 1000, "fused anchor renders");
        console2.log("sets ok: assemble, bonus once, vote, fuse, sold whole; anchor #", anchor);
    }

    function _payoutAndGuards() internal {
        // the split: 55 vault / 15 treasury / 15 team vesting / 15 growth
        vm.deal(address(PAYOUT), address(PAYOUT).balance + 10 ether);
        uint256 v0 = address(VAULT).balance;
        uint256 s0 = SAFE.balance;
        uint256 pending = address(PAYOUT).balance; // 10 ETH + the public mints not yet released
        assertEq(PAYOUT.releasable(address(VAULT)), pending * 55 / 100, "55% to the vault");
        PAYOUT.releaseAll();
        assertEq(address(VAULT).balance - v0, pending * 55 / 100, "55% to the vault");
        assertEq(SAFE.balance - s0, pending * 15 / 100, "15% to the treasury");
        assertLe(address(PAYOUT).balance, 3, "nothing left but rounding");
        // the sale manager can't touch what matters
        vm.startPrank(SALE_MANAGER);
        vm.expectRevert();
        FACES.updateCreatorPayoutAddress(address(SEADROP), SALE_MANAGER);
        vm.expectRevert();
        FACES.setMaxSupply(6000);
        vm.expectRevert();
        FACES.setMintPaused(true);
        vm.stopPrank();
        // the keeper can only buy basket tokens into the pool
        vm.prank(KEEPER);
        vm.expectRevert();
        VAULT.releaseSurplus(1);
        console2.log("payout split ok; sale manager and keeper can't move funds or change supply");
    }
}
