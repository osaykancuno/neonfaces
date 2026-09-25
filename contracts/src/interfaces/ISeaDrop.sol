// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Mirror of the SeaDrop 1.0 types and interfaces (github.com/ProjectOpenSea/seadrop, MIT), the
/// primary-drop contract OpenSea mints through. Upstream pins solc 0.8.17, so the ABI is copied here.
/// Function sets must stay identical to upstream: SeaDrop checks
/// `supportsInterface(type(INonFungibleSeaDropToken).interfaceId)` against its own compiled constant
/// (tested against the real SeaDrop bytecode in test/SeaDrop.t.sol).
///
/// SeaDrop is deployed at 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5 on Robinhood Chain mainnet and
/// testnet (bytecode identical to Ethereum's except its chain-id immutables).

struct PublicDrop {
    uint80 mintPrice;
    uint48 startTime;
    uint48 endTime;
    uint16 maxTotalMintableByWallet;
    uint16 feeBps;
    bool restrictFeeRecipients;
}

struct TokenGatedDropStage {
    uint80 mintPrice;
    uint16 maxTotalMintableByWallet;
    uint48 startTime;
    uint48 endTime;
    uint8 dropStageIndex;
    uint32 maxTokenSupplyForStage;
    uint16 feeBps;
    bool restrictFeeRecipients;
}

struct MintParams {
    uint256 mintPrice;
    uint256 maxTotalMintableByWallet;
    uint256 startTime;
    uint256 endTime;
    uint256 dropStageIndex;
    uint256 maxTokenSupplyForStage;
    uint256 feeBps;
    bool restrictFeeRecipients;
}

struct AllowListData {
    bytes32 merkleRoot;
    string[] publicKeyURIs;
    string allowListURI;
}

struct SignedMintValidationParams {
    uint80 minMintPrice;
    uint24 maxMaxTotalMintableByWallet;
    uint40 minStartTime;
    uint40 maxEndTime;
    uint40 maxMaxTokenSupplyForStage;
    uint16 minFeeBps;
    uint16 maxFeeBps;
}

/// @dev ERC721SeaDrop.MultiConfigureStruct — OpenSea Studio configures a drop with one
/// `multiConfigure(MultiConfigureStruct)` call (selector 0x911f456b).
struct MultiConfigureStruct {
    uint256 maxSupply;
    string baseURI;
    string contractURI;
    address seaDropImpl;
    PublicDrop publicDrop;
    string dropURI;
    AllowListData allowListData;
    address creatorPayoutAddress;
    bytes32 provenanceHash;
    address[] allowedFeeRecipients;
    address[] disallowedFeeRecipients;
    address[] allowedPayers;
    address[] disallowedPayers;
    address[] tokenGatedAllowedNftTokens;
    TokenGatedDropStage[] tokenGatedDropStages;
    address[] disallowedTokenGatedAllowedNftTokens;
    address[] signers;
    SignedMintValidationParams[] signedMintValidationParams;
    address[] disallowedSigners;
}

struct RoyaltyInfo {
    address royaltyAddress;
    uint96 royaltyBps;
}

/// @dev The SeaDrop contract (subset used by the token and by the tests).
interface ISeaDrop {
    function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)
        external
        payable;

    function mintAllowList(
        address nftContract,
        address feeRecipient,
        address minterIfNotPayer,
        uint256 quantity,
        MintParams calldata mintParams,
        bytes32[] calldata proof
    ) external payable;

    function updateDropURI(string calldata dropURI) external;
    function updatePublicDrop(PublicDrop calldata publicDrop) external;
    function updateAllowList(AllowListData calldata allowListData) external;
    function updateTokenGatedDrop(address allowedNftToken, TokenGatedDropStage calldata dropStage) external;
    function updateCreatorPayoutAddress(address payoutAddress) external;
    function updateAllowedFeeRecipient(address feeRecipient, bool allowed) external;
    function updateSignedMintValidationParams(address signer, SignedMintValidationParams calldata params) external;
    function updatePayer(address payer, bool allowed) external;

    function getPublicDrop(address nftContract) external view returns (PublicDrop memory);
    function getCreatorPayoutAddress(address nftContract) external view returns (address);
    function getAllowListMerkleRoot(address nftContract) external view returns (bytes32);
}

/// @dev Token side, metadata part. Upstream extends IERC2981; inherited functions are not part of an
/// interface id, so the id is the same without it.
interface ISeaDropTokenContractMetadata {
    function setBaseURI(string calldata tokenURI) external;
    function setContractURI(string calldata newContractURI) external;
    function setMaxSupply(uint256 newMaxSupply) external;
    function setProvenanceHash(bytes32 newProvenanceHash) external;
    function setRoyaltyInfo(RoyaltyInfo calldata newInfo) external;
    function baseURI() external view returns (string memory);
    function contractURI() external view returns (string memory);
    function maxSupply() external view returns (uint256);
    function provenanceHash() external view returns (bytes32);
    function royaltyAddress() external view returns (address);
    function royaltyBasisPoints() external view returns (uint256);
}

/// @dev Token side, mint part: what SeaDrop calls and what the owner forwards to SeaDrop.
interface INonFungibleSeaDropToken is ISeaDropTokenContractMetadata {
    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop) external;
    function mintSeaDrop(address minter, uint256 quantity) external;
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply);
    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop) external;
    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData) external;
    function updateTokenGatedDrop(address seaDropImpl, address allowedNftToken, TokenGatedDropStage calldata dropStage)
        external;
    function updateDropURI(address seaDropImpl, string calldata dropURI) external;
    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress) external;
    function updateAllowedFeeRecipient(address seaDropImpl, address feeRecipient, bool allowed) external;
    function updateSignedMintValidationParams(
        address seaDropImpl,
        address signer,
        SignedMintValidationParams memory signedMintValidationParams
    ) external;
    function updatePayer(address seaDropImpl, address payer, bool allowed) external;
}
