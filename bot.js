require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Identity } = require("@semaphore-protocol/identity");
const {Level} = require("level");
var ESSerializer = require('esserializer');
const serializer = require("serialize-javascript");
const { createWallet, sendEther, fetchBalance } = require('./wallet');
const {JsonRpcProvider } = require('ethers');


const purl = process.env.ETH_PROVIDER;
const provider = new JsonRpcProvider(purl);





// Initialize the database
// open or create the db if db is not available
const db_name = process.env.LEVEL_DB_NAME;
const db = new Level(db_name);

const wallet_db_name = process.env.WALLET_DB_NAME;
const wdb = new Level(wallet_db_name);

const my_base = 36;

// Initialize Telegram bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

async function create_get_wallet(userId) {
    try {
        const w = await wdb.get(userId);
        return JSON.parse(w);
    } catch(ex) {
        wallet = createWallet();
        await wdb.put(userId, JSON.stringify(wallet))
        return wallet;
    }
}

// Helper to assign a Semaphore identity
async function assign_or_retrieve_identity(userId) {
    try {
        const existingIdentity = await db.get(userId);
        return ESSerializer.deserialize(existingIdentity, [Identity]);
    } catch(ex) {

        if(ex.notFound) {
            // if the exception is that data is non-existing
            const semaphore_identity = new Identity();
            const buffer = ESSerializer.serialize(semaphore_identity);
            await db.put(userId, buffer);
            return semaphore_identity;
        } else {
            throw ex;
        }
    }
}

function parseBigInt(
    numberString,
    keyspace = "0123456789abcdefghijklmnopqrstuvwxyz",
  ) {
    let result = 0n;
    const keyspaceLength = BigInt(keyspace.length);
    for (let i = 0; i < numberString.length; i++) {
      const value = keyspace.indexOf(numberString[i]);
      if (value === -1) throw new Error("invalid string");
      result = result * keyspaceLength + BigInt(value);
    }
    return result;
  }

// Event handler for new members joining the group
bot.on('new_chat_members', async (msg) => {
    const newMembers = msg.new_chat_members;
    const chatId = msg.chat.id;

    for (const member of newMembers) {
        const userId = member.id;
        const res = await assign_or_retrieve_identity(userId);
        const res1 = await createWallet();


        bot.sendMessage(chatId, `New user is added, wallet is created and assigned an anonymous identity.`);
        let msg1 = `<b>Here is the detail for your semaphore:</b>\n\n<pre>${res}</pre>`
        bot.sendMessage(userId, msg1, {parse_mode: 'HTML'});
        let msg2 = `<b>Here is the detail for your wallet:</b>\n\n<pre>${JSON.stringify(res1)}</pre>`
        bot.sendMessage(userId, msg2);
    }
});

// get signature hex
function get_signature_hex(sign) {
    r81_hex = sign.R8[0].toString(my_base);
    r82_hex = sign.R8[1].toString(my_base);
    S_hex = sign.S.toString(my_base);
    return r81_hex+'-'+r82_hex+'-'+S_hex;
}

function get_pub_key_base_36(pub_key) {
    return pub_key[0].toString(36) + '-' + pub_key[1].toString(36);
}

function extractMessageData(loggedMessage) {
    const messageIdRegex = /message id:\s*\n\n(.*)/;
    const pubkeyRegex = /sender:\s*\n\n(.*)/;
    const signatureRegex = /signature:\s*\n\n(.*)/;
    const contentRegex = /Content:\s*\n\n(.*)/;

    const messageIdMatch = loggedMessage.match(messageIdRegex);
    const pubkeyMatch = loggedMessage.match(pubkeyRegex);
    const signatureMatch = loggedMessage.match(signatureRegex);
    const contentMatch = loggedMessage.match(contentRegex);

    const messageId = messageIdMatch ? messageIdMatch[1] : null;
    const pubkey = pubkeyMatch ? pubkeyMatch[1] : null;
    const signature = signatureMatch ? signatureMatch[1] : null;
    const content = contentMatch ? contentMatch[1] : null;

    return { messageId, pubkey, signature, content };
}

function processKeyAndSignature(mdata) {
    // Split pubkey and signature by '-'
    if(mdata == null) {
        return null;
    } else if (mdata.pubkey == null) {
        return null;
    } else if (mdata.signature == null) {
        return null;
    }

    let pubkey = mdata.pubkey;
    let signature = mdata.signature;
    const pubkeyParts = pubkey.split('-');
    const signatureParts = signature.split('-');

    // Convert each section from base 36 to BigInt
    let pubkey_bigint = ESSerializer.serialize([parseBigInt(pubkeyParts[0]), parseBigInt(pubkeyParts[1])]);
    let sign_bigint = ESSerializer.serialize({"R8": [parseBigInt(signatureParts[0]), parseBigInt(signatureParts[1]) ], "S": parseBigInt(signatureParts[2])});

    let pkid = ESSerializer.deserialize(pubkey_bigint, Identity.publicKey);
    let skid =  ESSerializer.deserialize(sign_bigint, Identity.Signature);

    let result = Identity.verifySignature(mdata.messageId, skid, pkid);
    return result;
}



// Event handler for incoming messages
bot.on('message', async (msg) => {

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text;

    bot.deleteMessage(chatId, msg.message_id)


    // Ignore non-text messages

    const masked_id = await assign_or_retrieve_identity(userId);
    pub_key = get_pub_key_base_36(masked_id._publicKey);
    // Use Semaphore to generate a proof (mocked here for simplicity)
    // In a real implementation, you'd generate a ZK proof with Semaphore

   if(text) {
       if(text == '/verify') {
        if (msg.reply_to_message) {
            const originalMessage = msg.reply_to_message;
            if(originalMessage.text || originalMessage.caption) {
                let mdata = originalMessage.text ? extractMessageData(originalMessage.text) : extractMessageData(originalMessage.caption);
                let is_verified = processKeyAndSignature(mdata);
                const header = is_verified ? `✅ <b>The signature is valid</b>` : `❌ <b>The signature is invalid or the metadata is empty.</b>`
                bot.sendMessage(chatId, header, {
                    reply_to_message_id: originalMessage.message_id,
                    parse_mode: 'HTML'
                });
            } else {
                bot.sendMessage(chatId, "⚠️ <b>Cannot verify the message!</b>",  {
                    reply_to_message_id: originalMessage.message_id,
                    parse_mode: 'HTML'
                })
            }

        } else {
            bot.sendMessage(chatId, "⚠️ Please reply to a message you want to verify");
        }
       } else if (text == '/wallet') {
                const x = await create_get_wallet(userId)
                bot.sendMessage(userId, `Your wallet details: <pre>${JSON.stringify(x)}</pre>`, {
                    parse_mode: 'HTML'
                });
        } else if (text == '/id') {
            const x = await assign_or_retrieve_identity(userId)
            bot.sendMessage(userId, `Your semaphore details: <pre>${serializer(x)}</pre>`, {
                parse_mode: 'HTML'
            });
        } else if (text.startsWith('/send')) {
            const w = await create_get_wallet(userId);
            let cmds = text.split(' ');
            if(cmds.length == 3) {
                let res = await sendEther(provider, w.privateKey, cmds[1], cmds[2]);
                bot.sendMessage(userId, `<code>Transaction receipt:</code>\n\n<pre>${JSON.stringify(res)}</pre>`, {parse_mode: 'HTML'});
            } else {
                bot.sendMessage(userId, `<code>The proper command is /send address amount</code>`, {parse_mode:'HTML'});
            }

        } else if (text == '/balance') {
            const w = await create_get_wallet(userId);
            const bal = await fetchBalance(provider, w.address);
            bot.sendMessage(userId, `<code> Your balance is </code>\n\n<pre>${bal} ether</pre>`, {parse_mode: 'HTML'})

        } else if (text == '/help') {
          const mt = `<b>Actions</b>\n\n/balance view your balance\n\n/wallet check your wallet details\n\n/id check your semaphore id\n\n/send [eth-addr] [eth-amt] - sends [eth-amt] to [eth-address] from wallet`;
          bot.sendMessage(chatId, mt, {parse_mode: 'HTML'})
        } else {
            let signature = masked_id.signMessage(msg.message_id);

            signature = get_signature_hex(signature);
            const header = `<b>message id: </b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${text}`;
            const anonymousMessage = header;
            // Send the anonymized message to the group
            bot.sendMessage(chatId, anonymousMessage, {parse_mode: 'HTML'});
       }
        
    } else if (msg.photo) {
        const photoId = msg.photo[msg.photo.length - 1].file_id; // Get the highest resolution photo
        const caption = msg.caption || ''
        let signature = masked_id.signMessage(msg.message_id)
        signature = get_signature_hex(signature);
        const header = `<b>message id:</b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${caption}`;
        const anonymousMessage = header;
        bot.sendPhoto(chatId, photoId, { caption: anonymousMessage, parse_mode: 'HTML' });

    } else if (msg.animation) {
        const gifId = msg.animation.file_id;
        const caption = msg.caption || ''
        let signature = masked_id.signMessage(msg.message_id)
        signature = get_signature_hex(signature);
        const header = `<b>message id:</b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${caption}`;
        const anonymousMessage = header;
        bot.sendAnimation(chatId, gifId, { caption:anonymousMessage, parse_mode: 'HTML' });

    } else if (msg.video) {
        const videoId = msg.video.file_id;
        const caption = msg.caption || ''
        let signature = masked_id.signMessage(msg.message_id)
        signature = get_signature_hex(signature);
        const header = `<b>message id:</b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${caption}`;
        const anonymousMessage = header;
        bot.sendVideo(chatId, videoId, { caption: anonymousMessage, parse_mode: 'HTML' });

    } else if (msg.document) {
        const documentId = msg.document.file_id;
        const caption = msg.caption || ''
        let signature = masked_id.signMessage(msg.message_id)
        signature = get_signature_hex(signature);
        const header = `<b>message id:</b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${caption}`;
        const anonymousMessage = header;
        bot.sendDocument(chatId, documentId, { caption: anonymousMessage, parse_mode: 'HTML' });

    } else if (msg.sticker) {
        const stickerId = msg.sticker.file_id;
        const caption = msg.caption || ''; // Use original caption or default message
        let signature = masked_id.signMessage(msg.message_id)
        signature = get_signature_hex(signature);
        const header = `<b>message id:</b>\n\n<code>${msg.message_id}</code>\n\n<b>sender:</b>\n\n<code>${pub_key}</code>\n\n<b>signature:</b>\n\n<code>${signature}</code>\n\n<b>content:</b>\n\n${caption}`;
        const anonymousMessage = header;
        await bot.sendSticker(chatId, stickerId, { caption: anonymousMessage, parse_mode: 'HTML' });

    } else if (msg.poll) {
        const question = msg.poll.question;
        const options = msg.poll.options.map(option => option.text); // Get poll options
        bot.sendPoll(chatId, question, options);
    }
});

  

