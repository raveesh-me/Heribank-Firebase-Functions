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
        const currentBalance = doccumentData.balance;

        await admin.firestore().doc(`users/${context.auth.uid}`).update({ balance: currentBalance - data.amount })
        await admin.firestore().doc(`tokens/${tokenString}`).set({
            amount: data.amount,
            time_generated: Date.now(),
            token_number: tokenString,
            sender: {
                uid: context.auth.uid,
                display_name: context.auth.token.name,
                email: context.auth.token.email
            }
        })

        return {data: tokenString}
    }
);