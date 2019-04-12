import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

function makeId(length: number): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    for (let index = 0; index < length; index++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export const addUserToFireStore = functions.auth.user().onCreate(
    (user) => {
        console.log(user.displayName)
        return admin.firestore().doc(`users/${user.uid}`).set({
            "display_name": user.displayName,
            "email": user.email,
            "photo_url": user.photoURL,
            "balance": 0,
            "secret_token": makeId(6),
        });
    }
);



export const generateToken = functions.https.onCall(
    async (data, context) => {
        console.log(data);
        console.log(context.auth);

        // If auth is null, return error
        if (!context.auth) {
            return new Error("Can't generate token on null authentication")
        }

        const userDocumentSnapshot = await admin.firestore().doc(`users/${context.auth.uid}`).get()
        console.log(`user doccument snapshot data`);
        console.log(userDocumentSnapshot.data());

        if (!userDocumentSnapshot.data) {
            // This should never be null because uid exists and has been authorised.
            return new Error("Someting went terribly wrong, contact your bank admins immediately")
        }

        const doccumentData = userDocumentSnapshot.data() as any;

        // check if secrets match
        if (data.secret_pin !== doccumentData.secret_pin) {
            return new Error("Secret pin does not match. You should not try to steal other people's money")
        }

        // At this point the auth exists, and secrets match. Now we check for sufficient balance
        if (doccumentData.balance < data.amount) {
            return new Error("People spending more than they have in their account is the recipe for economic cricis");
        }

        // Now we are sure that we can generate the token.
        const tokenString = makeId(4);

        // this gets moved to the fulfill transaction duties
        // await admin.firestore().doc(`users/${context.auth.uid}`).update({ balance: currentBalance - data.amount })
        await admin.firestore().doc(`tokens/${tokenString}`).set({
            amount: data.amount,
            time_generated: Date.now(),
            token_number: tokenString,
            sender: context.auth
        })

        return { data: tokenString }
    }
);



export const redeemToken = functions.https.onCall(
    async (data, context) => {
        console.log(data);
        console.log(context.auth);

        // If auth is null, return error
        if (!context.auth) {
            return new Error("Can't redeem token on null authentication")
        }

        const tokenDocumentSnapshot = await admin.firestore().doc(`tokens/${data.token}`).get();

        if (!tokenDocumentSnapshot.exists) {
            return new Error("The token does not exist")
        }
        // Now the user is logged in and the token also exists. We will make a new transaction and return a success message.
        // Another service is responsible for fulfilling the transaction.  This just makes a doccument to trigger that service.

        const tokenData: any = tokenDocumentSnapshot.data();

        // add a new transaction
        const transactionReference = await admin.firestore().collection('pending_transactions').add({
            token: tokenData,
            receiver: context.auth,
        })

        // move the token to redeemedTokens

        // deletion of token should take place not here, but as a part of the fulfillment process
        // await admin.firestore().doc(`redeemed_tokens/${data.token}`).set(tokenDocumentSnapshot.data);
        // await admin.firestore().doc(`tokens/${data.token}`).delete();

        return {
            message: "Transaction has successfully been created, will be fulfilled Shortly",
            transaction_id: transactionReference.id
        }

    }
);

export const fulfillTransaction = functions.firestore.document('pending_transactions/{transactionId}').onCreate(
    async (snapshot, context) => {
        console.log(snapshot.data);

        const transactionId = snapshot.id;
        const transaction: any = snapshot.data;

        const receiver = transaction.receiver;
        const sender = transaction.token.sender;
        const token = transaction.token;
        
        //reduce the amount from sender's account
        await admin.firestore().doc(`users/${sender.uid}`).update({
            balance: admin.firestore.FieldValue.increment(-1 * token.amount)
        });

        // add the balance to the receiver's account
        await admin.firestore().doc(`users/${receiver.uid}`).update({
            balance: admin.firestore.FieldValue.increment(token.amount)
        });

        //move the token to redeemed tokens
        // add the token to used tokens
        await admin.firestore().collection(`used_tokens`).add({
            token: token
        })

        // remove the token fromm the tokens
        await admin.firestore().doc(`tokens/${token.token_number}`).delete()

        //move the transaction to fulfilled transactions and individual user's transactions collections
        //this will make writing locked down rules easier
        // make a new transaction under fulfilled_transactions 
        await admin.firestore().doc(`fulfilled_transactions/${transactionId}`).set(transaction);
        await admin.firestore().doc(`users/${sender.uid}/fulfilled_transactions/${transactionId}`).set(transaction);
        await admin.firestore().doc(`users/${receiver.uid}fulfilled_transactions/${transactionId}`).set(transaction);
        
        //return deleting transaction from pending transactions
        return admin.firestore().doc(`pending_transactions/${transactionId}`).delete();

    }
);


export const expireToken = functions.firestore.document('tokens/{tokenID}').onCreate(
    async (snap, context) => {
        

        const token: any = snap.data;
        const tokenDocumentId = snap.id;

        return setTimeout(async () => {

            // check if the token has already been deleted. If yes, then return early
            const tokenDocumentSnaoshotAfterFiveMinutes = await admin.firestore().doc(`tokens/${tokenDocumentId}`).get();
            if(!tokenDocumentSnaoshotAfterFiveMinutes.exists){
                return {message : "The token has already been deleted, transaction could have been completed"}
            }

            // add the token to expired token
            await admin.firestore().collection(`expired_tokens`).add({
                token: token
            });

            return admin.firestore().doc(`tokens/${tokenDocumentId}`).delete();

        }, 
        5 * 60 * 1000) // wait for 5 minutes before calling the function
        
    }
);