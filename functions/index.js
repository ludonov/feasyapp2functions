require('@google-cloud/debug-agent').start({ allowExpressions: true });
const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// Take the text parameter passed to this HTTP endpoint and insert it into the
// Realtime Database under the path /messages/:pushId/original
exports.publishList = functions.https.onRequest((req, res) => {

    var idToken = req.query.token;
    console.log("validating token: " + idToken);

    var result = {};


    var GetRealExpiryDate = function (expdate) {
        let now = new Date();
        if (expdate == 0)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toUTCString();
        else if (expdate == 1)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59).toUTCString();
        else if (expdate == 2)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59).toUTCString();
        else if (expdate == 3)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59).toUTCString();
        else if (expdate == 4)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14, 23, 59, 59).toUTCString();
        else
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59).toUTCString();
    }


    admin.auth().verifyIdToken(idToken)
        .then(function (decodedToken) {
            var uid = decodedToken.uid;
            console.log("Token validated: " + uid);
            var list_key = req.query.list_key;
            var ref = admin.database().ref('/unpublished_lists/' + uid + '/' + list_key);
            ref.once("value", (snapshot) => {
                var unpub_list = snapshot.val();
                if (unpub_list != null) {
                    unpub_list.PublishedDate = (new Date()).toUTCString();
                    console.log("Publishing list...");
                    // pubblico su published_lists
                    admin.database().ref('/published_lists/' + uid).push(unpub_list).then(pub_list => {
                        console.log("List Published! Publishing geopoints...");
                        var counter = 0;
                        for (let address_key in unpub_list.DeliveryAddresses) {
                            var geo = {};
                            geo.own = uid;
                            geo.lst = pub_list.key;
                            geo.adr = address_key;
                            geo.rew = unpub_list.Reward;
                            geo.exp = GetRealExpiryDate(unpub_list.ExpiryDate);
                            geo.lat = unpub_list.DeliveryAddresses[address_key].Latitude;
                            geo.lng = unpub_list.DeliveryAddresses[address_key].Longitude;
                            geo.com = unpub_list.DeliveryAddresses[address_key].Comments || "";
                            geo.cnt = Object.keys(unpub_list.Items).length;
                            admin.database().ref("geopoints").push(geo).then((geo_pushed) => {
                                console.log("Geopoint published");
                                admin.database().ref('/published_lists/' + uid + '/' + pub_list.key + '/DeliveryAddresses/' + address_key + '/GeopointKey').set(geo_pushed.key).then(res2 => {
                                    counter++;
                                    if (counter >= Object.keys(unpub_list.DeliveryAddresses).length) {
                                        console.log("Removing list from unpublished_lists...");
                                        admin.database().ref('/unpublished_lists/' + uid + '/' + list_key).remove().then(removed => {
                                            console.log("Final step done. Removed list from unpublished lists!");
                                            result.error = false;
                                            result.errorMessage = "";
                                            res.send(200, JSON.stringify(result));
                                        }).catch((err) => {
                                            console.warn("Cannot remove list from unpublished lists: " + err.message);
                                            result.error = true;
                                            result.errorMessage = "Cannot remove list from unpublished lists: " + err.message;
                                            res.send(200, JSON.stringify(result));
                                        });
                                    }
                                });
                            }).catch((err) => {
                                console.warn("Cannot publish geopoint: " + err.message);
                                result.error = true;
                                result.errorMessage = "Cannot publish geopoint: " + err.message;
                                res.send(200, JSON.stringify(result));
                            });
                        }
                    }).catch(err => {
                        console.warn("Cannot push to published_lists: " + err.message);
                        result.error = true;
                        result.errorMessage = "cannot push to published_lists: " + err.message;
                        res.send(200, JSON.stringify(result));
                    });
                } else {
                    console.warn("list_key not existing");
                    result.error = true;
                    result.errorMessage = "list_key not existing";
                    res.send(200, JSON.stringify(result));
                }
            });
        }).catch(function (error) {
            console.warn("Token NOT validated: " + error);
            result.error = true;
            result.errorMessage = "Token NOT validated: " + error;
            res.status(200).send(JSON.stringify(result));
        });


  // Grab the text parameter.
  //const original = req.query.text;
  //var q = req.query;
  //console.log("Adding new msg: " + original);
  //// Push it into the Realtime Database then send a response
  //admin.database().ref('/messages').push({original: original}).then(snapshot => {
  //  // Redirect with 303 SEE OTHER to the URL of the pushed object in the Firebase console.
  //  res.redirect(303, snapshot.ref);
  //});

  //if (this.IsAlreadyCandidate(candidature.ListReferenceKey)) {
      //  reject(new Error("already_candidated"));
      //} else {
      //  let cand_db_promise = this.af.database.list("/candidates/" + candidature.ListOwnerUid + "/" + candidature.ListReferenceKey).push(StripForFirebase(candidate));
      //  cand_db_promise.then((cand_db) => {
      //    candidature.CandidateReferenceKey = cand_db_promise.key;
      //    this.Candidatures_db.push(candidature).then(() => {
      //      console.log("Globals.AddCandidature > new candidature pushed");
      //      resolve(true);
      //    }).catch((err: Error) => {
      //      reject(new Error("cannot add candidature to db: " + err.message));
      //    });
      //  }).catch((err: Error) => {
      //    reject(new Error("cannot add candidate to db: " + err.message));
      //  });
      //}


});

//exports.makeUppercase = functions.database.ref('/messages/{pushId}/original')
//  .onWrite(event => {
//    // Grab the current value of what was written to the Realtime Database.
//    const original = event.data.val();
//    console.log('Uppercasing', event.params.pushId, original);
//    const uppercase = original.toUpperCase();
//    // You must return a Promise when performing asynchronous tasks inside a Functions such as
//    // writing to the Firebase Realtime Database.
//    // Setting an "uppercase" sibling in the Realtime Database returns a Promise.
//    return event.data.ref.parent.child('uppercase').set(uppercase);
//  });
