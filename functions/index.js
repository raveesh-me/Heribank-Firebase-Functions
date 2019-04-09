const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();


function makeid(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    for (var i = 0; i < length; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}


exports.addUserToFireStore = functions.auth.user().onCreate((user) => {
    console.log(user.displayName);
    return admin.firestore().doc(`users/${user.uid}`).set({
        "display_name": user.displayName,
        "email": user.email,
        "photo_url": user.photoURL,
        "balance": 0,
        "secret_token": makeid(6),
    });
});




// const something = user_doc => {
//     const serverSecret = user_doc.data.secret_pin;
//     if (serverSecret !== received_secret) {
//         throw new Error("User secrets don't match")
//     }
//     else if (amount > document.data.balance) {
//         throw new Error("you dont have enough balance")
//     }
//     const tokenNumber = makeid(4);
//     return admin.firestore().collection(`tokens`).add({
//         token_number: tokenNumber,
//         sender: {
//             uid: user.uid,
//             email: user.email,
//         }
//     })
//     // docRef => response.send({ data: { token: tokenNumber } })

// }

exports.generateToken = functions.https.onCall(
    (data, context) => {
        console.log(data);
        console.log(context.auth);
        // return {data: '112233'};
        const request_uid = context.auth.uid;
        const amount = data.amount;
        // const received_secret = request.body.secret;
        // console.log(`User UID is ${user.uid} name is ${user.displayName} is requesting for a token of amount: ${request.body.amount}`);
        // const userDocumentPromise = admin.firestore().doc(`users/${user.uid}`).get();
    }
);
