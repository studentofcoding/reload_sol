import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAllDigitalAssetWithTokenByOwner } from "@metaplex-foundation/mpl-token-metadata";
import { Connection } from "@solana/web3.js";
import { publicKey } from "@metaplex-foundation/umi";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";

export async function walletScan(address: string) {
    try {
        // console.log('wallet address ===> ', address)
        let walletInf = 0;

        const umi = createUmi(new Connection(String(process.env.NEXT_PUBLIC_SOLANA_RPC)));
        umi.use(dasApi());

        // The owner's public key
        const ownerPublicKey = publicKey(
            address,
        );

        // console.log("Fetching wallet data ...");
        const allFTs = await fetchAllDigitalAssetWithTokenByOwner(
            umi,
            ownerPublicKey,
        );

        allFTs.forEach((ft, index) => {
            if (ft.publicKey === process.env.NEXT_PUBLIC_MINT_ADDRESS) {
                walletInf = Number(ft.token.amount) / Math.pow(10, ft.mint.decimals);
            }
        })

        return walletInf;

    } catch (error) {
        console.error("Error:", error);
        return { nft: 0, ft: 0 }
    }
}