// backend/utils/encryption_helper.js

const crypto = require('crypto'); // Node.js built-in crypto module

// Define the character set used by the external site's randomString function
const $aes_chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz23456578";
const aes_chars_len = $aes_chars.length;

// Replicate the randomString function from the external site
// TEMPORARILY MODIFIED FOR TEST VECTOR COMPARISON
function generateRandomString(n) {
	/*
     // >>>>>> TEMPORARY: Use fixed strings/bytes for test vector comparison <<<<<<<
    // Use the exact strings/bytes observed in the browser debugger FOR A SINGLE RUN
    // This is the 64-character prefix observed in THIS browser log
    const fixedPrefix64 = "e7XPMKA4fswzekQSQ65BXaQBjPMehJCCcyAn2eCXmKxzjD3XijC8EpTeXf8rQ5Qz";
    // This is the HEX string of the 16 bytes observed in the IV WordArray (c.words) for THIS run
    const fixedIVHex = "486634534d5241797468337470653836";

    if (n === 64) {
         console.log(">>> TEST MODE: generateRandomString(64) - Using fixed 64-char prefix:", fixedPrefix64);
        return fixedPrefix64;
    }
     if (n === 16) {
         console.log(">>> TEST MODE: generateRandomString(16) - Using fixed IV bytes (hex):", fixedIVHex);
         // Return a Buffer created directly from the hex string for the IV
         return Buffer.from(fixedIVHex, 'hex'); // <<< Return Buffer from hex for IV
     }
	 // >>>>>> END TEMPORARY <<<<<<<
	*/
    // Original random logic for other cases (should not be used with n=64 or n=16 in test mode)
    console.log(`>>> generateRandomString called with n=${n}. Using original random logic.`);
    let result = "";
    for (let i = 0; i < n; i++) {
        result += $aes_chars.charAt(Math.floor(Math.random() * aes_chars_len));
    }
    return result;
}

// Implement the AES encryption replicating the external site's logic
function encryptPasswordWithSalt(rawPassword, salt) {
    try {
        // Step 1: Generate 64-character random prefix (will use fixed one in test mode)
        const randomPrefix = generateRandomString(64); // Returns string (fixed in test mode)
         console.log('\n--- Encryption Process Logs ---');
         console.log('Raw Password:', rawPassword);
         console.log('Salt:', salt);
         console.log('Generated Random Prefix (64 char):', randomPrefix);


        // Step 2: Get the IV Buffer (will use fixed bytes from hex in test mode)
        // The call to generateRandomString(16) now returns a Buffer in test mode
        const ivBuffer = generateRandomString(16); // <<< Directly get the IV Buffer


        // Step 3: Concatenate random prefix and raw password
        const dataToEncrypt = randomPrefix + rawPassword;
        const dataToEncryptBuffer = Buffer.from(dataToEncrypt, 'utf8');
         console.log('Data to Encrypt String (Prefix + Password):', dataToEncrypt);
         console.log('Data to Encrypt Buffer (Bytes):', dataToEncryptBuffer.toString('hex')); // Log as hex for comparison


        // Step 4: Key is salt (Utf8 bytes) - AES-128 requires 16 bytes
        const keyBuffer = Buffer.from(salt, 'utf8');
         console.log('Key Buffer (Salt Bytes):', keyBuffer.toString('hex'));


        // Step 5: IV is the Buffer from the 16 observed bytes (obtained in Step 2)
         console.log('IV Buffer (Observed IV Bytes):', ivBuffer.toString('hex')); // Log as hex


        // Ensure key and IV lengths are correct for AES-128-CBC (16 bytes each)
        if (keyBuffer.length !== 16) {
             console.error(`Encryption key length is not 16 bytes. Expected 16, got ${keyBuffer.length}. Salt value: "${salt}"`);
             throw new Error('Invalid salt length for AES-128 key.');
        }
         if (ivBuffer.length !== 16) {
             console.error(`Encryption IV length is not 16 bytes. Expected 16, got ${ivBuffer.length}. Check generateRandomString(16).`);
             throw new Error('Invalid IV length.');
         }


        // Step 6: Create AES cipher: AES-128-CBC with salt as key and observed IV bytes as IV
        const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, ivBuffer);
         console.log('Created AES-128-CBC cipher.');


        // Step 7: Encrypt data (Padding Pkcs7 is default for createCipheriv)
        let encrypted = cipher.update(dataToEncryptBuffer); // Input is Buffer
        encrypted = Buffer.concat([encrypted, cipher.final()]); // Finalize and concatenate
         console.log('Encrypted Ciphertext Buffer (Bytes):', encrypted.toString('hex'));


        // Step 8: Output is Base64 of the ciphertext
        const base64Output = encrypted.toString('base64');
         console.log('Final Encrypted Output (Base64):', base64Output);
         console.log('--- End Encryption Process Logs ---');

        return base64Output;

    } catch (e) {
        console.error('Error during password encryption:', e);
        console.error('Encryption error stack:', e.stack);
        throw new Error('Password encryption failed during processing.');
    }
}

// Export the main encryption function
module.exports = {
    generateRandomString, // Export the original random string function too if needed elsewhere
    encryptPasswordWithSalt,
};

/*
// >>>>>> TEMPORARY TEST VECTOR COMPARISON <<<<<<<
// Run this file directly or ensure this section is executed when testing
console.log("--- Running Encryption Test Vector Comparison ---");

// Inputs from the SPECIFIC browser run you want to match
const testSalt = 'qdIGSxtUaqsX9jbs'; // Salt from that run
const testRawPassword = 'YourTestPassword123'; // Password used
// The expected Base64 output FROM THE BROWSER for this specific set of inputs (Prefix + Password + Salt + IV Bytes)
const expectedBase64Output = 'BvuaNrOjPsdNxi+7lbRVszKBgdzYAILodwD2uTrn45lO0aGDw35SVLyNMCIcwfTXh2IidmzPHiDkDJi0kMq/fPLYakLVuBYnOSG73vYhfuZX/SOuoonbmobydsXnwUEQ'; // <<< YOU MUST REPLACE THIS WITH THE VALUE FROM THE BROWSER NETWORK TAB!

if (expectedBase64Output === 'PASTE_THE_CORRECT_BASE64_OUTPUT_FOR_THIS_RUN_HERE') {
     console.error("\n!!! IMPORTANT: Update expectedBase64Output in encryption_helper.js with the Base64 output from the browser for this test vector! !!!\n");
} else {
    try {
        // Call the encryption function with the fixed inputs (which use fixed random values internally in test mode)
        const nodejsEncryptedOutput = encryptPasswordWithSalt(testRawPassword, testSalt);

        console.log("\n--- Comparing Outputs ---");
        console.log("Node.js Encrypted Output (Base64):", nodejsEncryptedOutput);
        console.log("Expected Encrypted Output (Base64):", expectedBase64Output);

        if (nodejsEncryptedOutput === expectedBase64Output) {
            console.log("\n--- Encryption Test MATCHES Expected Output! ✅ ---");
            console.log("Your Node.js encryption logic now matches the external site for this test vector.");
            console.log("The 401 error should be resolved if the inputs are correct during a live login.");
             console.log("\n>>> REMEMBER to remove ALL TEMPORARY test code and fixed values when done testing! <<<\n");
        } else {
            console.log("\n--- Encryption Test DOES NOT MATCH Expected Output! ❌ ---");
            console.log("Despite using the observed inputs, there is still a discrepancy.");
            console.log("This indicates a very subtle difference in the AES implementation or padding.");
             console.log("\n>>> REMEMBER to remove ALL TEMPORARY test code and fixed values when done testing! <<<\n");
        }
    } catch (e) {
        console.error("\nError running Node.js encryption test:", e.message);
         console.error("Test aborted due to encryption error.");
         console.log("\n>>> REMEMBER to remove ALL TEMPORARY test code and fixed values when done testing! <<<\n");
    }
}

console.log("\n--- Finished Encryption Test Vector Comparison ---");
// >>>>>> END TEMPORARY TEST VECTOR COMPARISON <<<<<<<
*/