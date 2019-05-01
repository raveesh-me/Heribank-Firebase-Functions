import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

function makeId(length: number): string {
    // This is an internal function responsible for making radom IDs of specified lengths
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    for (let index = 0; index < length; index++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}


export const addUserToFireStore = functions.auth.user().onCreate(
    // This is an auth based trigger that, on new accounts being made, adds the user to the database
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
    // This is a https based onCall trigger.
    // This contains input data as well as authentication context
    // This means we can verify the user as well as get data
    async (data, context) => {
        console.log(data);

        // If auth is null, return error
        if (!context.auth) {
            return {
                status: "error",
                message: "Can't generate token on null authentication",
            }
        }

        console.log(context.auth);

        const userDocumentSnapshot = await admin.firestore().doc(`users/${context.auth.uid}`).get()

        if (!userDocumentSnapshot.data) {
            // This error should not happen.
            // User Snapshot Data should never be null because uid exists and has been authorised.
            return {
                status: "error",
                message: "Someting went terribly wrong, contact your bank admins immediately",
            }
        }

        console.log(`user doccument snapshot data`);
        console.log(userDocumentSnapshot.data());


        // typecasting to a generic object to be able to use this as a map later
        const doccumentData = userDocumentSnapshot.data() as any;

        // check if secrets match
        if (data.secret_pin !== doccumentData.secret_pin) {
            return {
                status: "error",
                message: "Secret pin does not match. You should not try to steal other people's money",
            }
        }
        console.log('Secret pins match');

        // At this point the auth exists, and secrets match. Now we check for sufficient balance
        if (doccumentData.balance < data.amount) {
            console.log('balance not enough');
            return {
                status: "error",
                message: "People spending more than they have in their account is the recipe for economic cricis",
            }
        }
        console.log('all check, generating token...');

        // Now we are sure that we can generate the token.
        const tokenString = makeId(4);

        // this gets moved to the fulfill transaction duties
        // await admin.firestore().doc(`users/${context.auth.uid}`).update({ balance: currentBalance - data.amount })
        await admin.firestore().doc(`tokens/${tokenString}`).set({
            amount: data.amount,
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
            return {
                status: 'ERROR',
                message: 'Can\'t redeem token on null authentication'
            };
        }

        const tokenDocumentSnapshot = await admin.firestore().doc(`tokens/${data.token}`).get();

        if (!tokenDocumentSnapshot.exists) {
            return {
                status: 'ERROR',
                message: "The token does not exist"
            }
        }

        // Now the user is logged in and the token also exists. We will make a new transaction and return a success message.
        // Another service is responsible for fulfilling the transaction.  This just makes a doccument to trigger that service.
        const tokenData: any = tokenDocumentSnapshot.data();

        // add a new transaction
        const transactionReference = await admin.firestore().collection('pending_transactions').add({
            token: tokenData,
            receiver: context.auth,
        })

        // delete the redeemed token
        await admin.firestore().doc(`tokens/${data.token}`).delete();

        console.log("Transaction has successfully been created, will be fulfilled Shortly")
        return {
            status: 'OK',
            message: "Transaction has successfully been created, will be fulfilled Shortly",
            transaction_id: transactionReference.id
        }

    }
);

export const fulfillTransaction = functions.firestore.document('pending_transactions/{transactionId}').onCreate(
    // This is the pending transaction fulfillment responsible for:
        // Deducting amount from sender
        // Adding amount to receiver
        // Adding transaction to bank's records
        // Adding transaction to sender's records
        // Adding transaction to receiver's records

    async (snapshot : FirebaseFirestore.DocumentSnapshot, context) => {
        console.log("Fulfill Transaction triggered")

        // step1: extract the data from the snapshot into a typescript object
        const document: any = snapshot.data() as any;
        console.log(document);

        // step2: identify sender and receiver
        // step2a: identify the receiver
        const receiver: any = document.receiver;
        console.log(receiver);
        console.log(`RECEIVER: ${receiver.token.name}`)
        
        //step2b: Identify the sender
        const sender: any = document.token.sender;
        console.log(sender);
        console.log(`SENDER: ${sender.token.name}`);

        // step3: identify the transaction id
        const transactionId = snapshot.id;
        console.log(`TRANSACTION ID: ${transactionId}`);

        // step4 retreive tokenDetails
        const token = document.token;

        // step5: deduct the transaction from sender and add it to sender's transactions collection as sent
        await admin.firestore().doc(`users/${sender.uid}`).update({
            balance: admin.firestore.FieldValue.increment(-1 * token.amount)
        });

        await admin.firestore().collection(`users/${sender.uid}/transactions`).doc(`${transactionId}`).set({
            type: `sent`,
            token_number: token.token_number,
            amount: token.amount,
            receiver: receiver,
        });

        // step6: add the money to receiver's account and add it to his transactions as received
        await admin.firestore().doc(`users/${receiver.uid}`).update({
            balance: admin.firestore.FieldValue.increment(token.amount)
        });

        await admin.firestore().collection(`users/${receiver.uid}/transactions`).doc(`${transactionId}`).set({
            type: `received`,
            token_number: token.token_number,
            amount: token.amount,
            sender: sender,
        });

        // step7: add the transaction to completed transactions
        await admin.firestore().collection(`completed_transactions`).doc(`${transactionId}`).set({
            sender: sender,
            receiver: receiver,
            amount: token.amount,
            token_number: token.token_number,
        });

        // step8: return deleting transaction from pending transactions
        return admin.firestore().doc(`pending_transactions/${transactionId}`).delete();

    }
);

