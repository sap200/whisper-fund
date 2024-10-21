const { ethers } = require('ethers');




function createWallet() {
    const newWallet = ethers.Wallet.createRandom();
    return {
        address: newWallet.address,
        privateKey: newWallet.privateKey,
        mnemonic: newWallet.mnemonic.phrase,
    };
}

// Function to send Ether
async function sendEther(provider, private_key, toAddress, amountInEther) {
    // ether provider 

    try {
        // Validate the address
        if (!ethers.isAddress(toAddress)) {
            return {"Error": "Invalid ethereum address"}
        }
        
        const wallet = new ethers.Wallet(private_key, provider);

        const amountInWei = ethers.parseEther(amountInEther);
        const transaction = {
            to: toAddress,
            value: amountInWei,
        };

        const txResponse = await wallet.sendTransaction(transaction);
        const receipt = await txResponse.wait();
        return receipt;
    } catch (error) {
        return error;
    }
}

async function fetchBalance(provider, address) {
    // ether provider 

    try {
        // Validate the address
        if (!ethers.isAddress(address)) {
            return new Error('Invalid Ethereum address');
        }

        // Fetch the balance in Wei
        const balanceWei = await provider.getBalance(address);

        // Convert the balance from Wei to Ether
        const balanceEther = ethers.formatEther(balanceWei);

        return balanceEther; // Return balance in Ether
    } catch (error) {
        return error; // Rethrow the error for further handling if needed
    }
}

// Export the functions
module.exports = {
    createWallet,
    sendEther,
    fetchBalance,
};