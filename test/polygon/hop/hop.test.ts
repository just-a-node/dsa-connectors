import { expect } from "chai";
import hre from "hardhat";
const { waffle, ethers } = hre;
const { provider } = waffle;

import { deployAndEnableConnector } from "../../../scripts/tests/deployAndEnableConnector";
import { buildDSAv2 } from "../../../scripts/tests/buildDSAv2";
import { encodeSpells } from "../../../scripts/tests/encodeSpells";
import { getMasterSigner } from "../../../scripts/tests/getMasterSigner";
import { addLiquidity } from "../../../scripts/tests/addLiquidity";
import { addresses } from "../../../scripts/tests/polygon/addresses";
import { abis } from "../../../scripts/constant/abis";
import { ConnectV2HopPolygon__factory } from "../../../typechain";
import { Signer, Contract } from "ethers";
import BigNumber from "bignumber.js";

describe("Hop Connector", function () {
  const connectorName = "HOP-A";

  let dsaWallet0: Contract;
  let masterSigner: Signer;
  let instaConnectorsV2: Contract;
  let connector: Contract;
  let latestBlock: any;

  const wallets = provider.getWallets();
  const [wallet0, wallet1, wallet2, wallet3] = wallets;
  before(async () => {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            // @ts-ignore
            jsonRpcUrl: hre.config.networks.hardhat.forking.url,
            blockNumber: 27054896
          }
        }
      ]
    });

    masterSigner = await getMasterSigner();
    instaConnectorsV2 = await ethers.getContractAt(abis.core.connectorsV2, addresses.core.connectorsV2);
    connector = await deployAndEnableConnector({
      connectorName,
      contractArtifact: ConnectV2HopPolygon__factory,
      signer: masterSigner,
      connectors: instaConnectorsV2
    });
    console.log("Connector address", connector.address);
  });

  it("Should have contracts deployed.", async function () {
    expect(!!instaConnectorsV2.address).to.be.true;
    expect(!!connector.address).to.be.true;
    expect(!!(await masterSigner.getAddress())).to.be.true;
  });

  describe("DSA wallet setup", function () {
    it("Should build DSA v2", async function () {
      dsaWallet0 = await buildDSAv2(wallet0.address);
      expect(!!dsaWallet0.address).to.be.true;
    });

    it("Deposit MATIC & DAI into DSA wallet", async function () {
      await wallet0.sendTransaction({
        to: dsaWallet0.address,
        value: ethers.utils.parseEther("10")
      });
      expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.gte(ethers.utils.parseEther("10"));

      await addLiquidity("dai", dsaWallet0.address, ethers.utils.parseEther("10000"));
    });
  });

  describe("Main", function () {
    it("should migrate from L2 to L1", async function () {
      const amount = ethers.utils.parseEther("10");
      const DAI_ADDR = "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063";
      const l2AmmWrapper = "0x28529fec439cfF6d7D1D5917e956dEE62Cd3BE5c";
      const bonderFee = new BigNumber(100 * 1e9)
        .multipliedBy(150000)
        .multipliedBy(1.5)
        .plus(new BigNumber(amount.toString()).multipliedBy(0.72));
      const deadline = Date.now() + 604800;
      const getId = "0";

      const token = new ethers.Contract(DAI_ADDR, abis.basic.erc20);
      await token.connect(wallet0).approve(l2AmmWrapper, amount.toString());

      const params: any = [
        DAI_ADDR,
        l2AmmWrapper,
        wallet0.address,
        1,
        amount.toString(),
        bonderFee.toString(),
        "0",
        deadline,
        "0",
        "0"
      ];

      const spells = [
        {
          connector: connectorName,
          method: "bridge",
          args: [params, getId]
        }
      ];

      const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address);
      let receipt = await tx.wait();
      latestBlock = receipt.blockNumber;
    });

    it("Should fetch transferId from TransferSent Event", async function () {
      const l2Bridge = "0xEcf268Be00308980B5b3fcd0975D47C4C8e1382a";
      const ABI = [
        {
          anonymous: false,
          inputs: [
            { indexed: true, internalType: "bytes32", name: "transferId", type: "bytes32" },
            { indexed: true, internalType: "uint256", name: "chainId", type: "uint256" },
            { indexed: true, internalType: "address", name: "recipient", type: "address" },
            { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
            { indexed: false, internalType: "bytes32", name: "transferNonce", type: "bytes32" },
            { indexed: false, internalType: "uint256", name: "bonderFee", type: "uint256" },
            { indexed: false, internalType: "uint256", name: "index", type: "uint256" },
            { indexed: false, internalType: "uint256", name: "amountOutMin", type: "uint256" },
            { indexed: false, internalType: "uint256", name: "deadline", type: "uint256" }
          ],
          name: "TransferSent",
          type: "event"
        }
      ];
      const l2BridgeInstance = new ethers.Contract(l2Bridge, ABI);
      const filter = l2BridgeInstance.connect(wallet0).filters.TransferSent();
      const events = await l2BridgeInstance.connect(wallet0).queryFilter(filter, 27054896, latestBlock);

      const transferSentEvent: any = events[0].args;

      expect(transferSentEvent[2].toLowerCase()).to.be.equals(wallet0.address.toLowerCase());
      console.log("TransferId", transferSentEvent[0]);
    });
  });
});
