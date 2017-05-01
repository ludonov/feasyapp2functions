//require('@google-cloud/debug-agent').start({ allowExpressions: true });
const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);


function once(dbRef) {
  let defer = new Promise((resolve, reject) => {
    dbRef.once('value', (snap) => {
      let data = snap.val();
      resolve(data);
    }, (err) => {
      reject(err);
    });
  });
  return defer;
}


function GetRealExpiryDate(expdate) {
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



// Publish a list. Moves it from unpublished_lists to published_lists and publishes geopoints
exports.publishList = functions.database.ref('/published_lists/{userId}/{listId}').onWrite(event => {

  // Only edit data when it is first created.
  if (event.data.exists() && !event.data.previous.exists()) {

    let uid = event.params.userId;
    let list_key = event.params.listId;
    let pub_list = event.data.val();

    delete pub_list.Publish;
    console.log("Publishing list and geopoints...");
    let promises = [];
    for (let address_key in pub_list.DeliveryAddresses) {
      let geo = {};
      geo.own = uid;
      geo.lst = list_key;
      geo.adr = address_key;
      geo.rew = pub_list.Reward;
      geo.exp = GetRealExpiryDate(pub_list.ExpiryDate);
      geo.lat = pub_list.DeliveryAddresses[address_key].Latitude;
      geo.lng = pub_list.DeliveryAddresses[address_key].Longitude;
      geo.com = pub_list.DeliveryAddresses[address_key].Comments || "";
      geo.cnt = Object.keys(pub_list.Items).length;
      promises.push(
        admin.database().ref("geopoints").push(geo).then((geo_pushed) => {
          console.log("Geopoint published");
          return admin.database().ref('/published_lists/' + uid + '/' + list_key + '/DeliveryAddresses/' + address_key + '/GeopointKey').set(geo_pushed.key);
        }).catch((err) => {
          console.warn("Cannot publish geopoint: " + err.message);
          return;
        })
      );
    }

    promises.push(event.data.ref.update({ PublishedDate: (new Date()).toUTCString() }));

    promises.push(admin.database().ref('/unpublished_lists/' + uid + '/' + pub_list.UnpublishedListKey).remove());

    return Promise.all(promises).then(() => {
      console.log("All done: Geopoints published and list removed from unpublished_lists.");
      return;
    });

  } else {
    return;
  }
});


// When a shopper make a candidature, this function automatically adds the candidate to the demander's candidates
// which will trigger a notifitication on demander's side
exports.addCandidate = functions.database.ref('/candidatures/{userId}/{candidatureId}')
  .onWrite(event => {
    try {

      // Only edit data when it is first created.
      if (event.data.previous.exists()) {
        return;
      }
      // Exit when the data is deleted.
      if (!event.data.exists()) {
        return;
      }

      // Grab the current value of what was written to the Realtime Database.
      let candidature = event.data.val();
      console.log('Intercepted candidature of user: <' + event.params.userId + '> with key <' + event.params.candidatureId + '>');

      let ListOwnerUid = candidature.ListOwnerUid;
      let ListReferenceKey = candidature.ListReferenceKey;
      let AddressKey = candidature.AddressKey;
      let Comment = candidature.Comment;
      console.log('ListOwnerUid: ' + ListOwnerUid);
      console.log('ListReferenceKey: ' + ListReferenceKey);
      console.log('AddressKey: ' + AddressKey);
      console.log('Comment: ' + Comment);

      let new_candidate = {};
      new_candidate.uid = event.params.userId;
      new_candidate.ListReferenceKey = ListReferenceKey;
      new_candidate.AddressKey = AddressKey;
      new_candidate.CandidatureReferenceKey = event.params.candidatureId;
      new_candidate.Visualised = false;
      new_candidate.Comment = Comment || "";

      return once(admin.database().ref('/users/' + event.params.userId + '/DisplayName')).then(user_name => {
        new_candidate.DisplayName = user_name;
        console.log('DisplayName: ' + user_name);
        return admin.database().ref('/candidates/' + ListOwnerUid).push(new_candidate).then(() => {
          console.log('All done!');
          return;
        });
      });

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }
  });


// When a candidate is chosen by the demander, automatically set <Accepted=true> to shopper's candidature
// Removes list from the map (geopoints)
exports.acceptCandidate = functions.database.ref('/published_lists/{userId}/{listId}')
  .onWrite(event => {

    try {
      // Only edit data when it is first created or changes from empty to some value.
      if (event.data.exists() && event.data.child('ChosenCandidateKey').exists() && !event.data.child('ChosenCandidateKey').previous.exists()) {

        let uid = event.params.userId;
        let list_key = event.params.listId;
        let pub_list = event.data.val();
        let newChat = {};

        // Grab the current value of what was written to the Realtime Database.
        let acceptedCandidateKey = event.data.child('ChosenCandidateKey').val();
        console.log('Candidate <' + acceptedCandidateKey + '> accepted for list <' + list_key + '> of user <' + uid + '>');

        return once(admin.database().ref('/candidates/' + uid + '/' + acceptedCandidateKey)).then(candidate => {
          
          newChat.DemanderUid = uid;
          newChat.ShopperUid = candidate.uid;
          newChat.DemanderName = pub_list.DemanderName;
          newChat.ShopperName = candidate.DisplayName;

          return admin.database().ref('/chats').push(newChat).then( _addedChat => {

            //all the promises the function will create
            let promises = [];

            console.log("candidate: " + JSON.stringify(candidate));

            promises.push(
              admin.database().ref('/user_chats/' + uid).update({ [_addedChat.key]: 0 }).then(() => {
                console.log("Chat created for Demander");
              }).catch((err) => {
                console.warn("Cannot create chat for demander " + err.message);
              })
            );

            promises.push(
              admin.database().ref('/user_chats/' + candidate.uid).update({ [_addedChat.key]: 0 }).then(() => {
                console.log("Chat created for Shopper");
              }).catch((err) => {
                console.warn("Cannot create chat for shopper " + err.message);
              })
            );

            promises.push(
              event.data.ref.update({ ChosenCandidatureKey: candidate.CandidatureReferenceKey, ChosenShopperUid: candidate.uid, ChosenShopperName: candidate.DisplayName }).then(() => {
                console.log("Shopper data Updated");
              }).catch((err) => {
                console.warn("Cannot update shopper data: " + err.message);
              })
            );

            promises.push(
              event.data.ref.child('DeliveryAddresses').child(candidate.AddressKey).child('Chosen').set(true).then(() => {
                console.log("Updated chosen address.");
              }).catch((err) => {
                console.warn("Cannot update chosen address: " + err.message);
              })
            );

            promises.push(
              admin.database().ref('/candidatures/' + candidate.uid + '/' + candidate.CandidatureReferenceKey + '/Accepted').set(true).then(() => {
                console.log("Shopper set as Accepted.");
              }).catch((err) => {
                console.warn("Cannot set accepted to shopper's candidature: " + err.message);
              })
            );

            let geopoint_to_update = {};
            for (let address_key in pub_list.DeliveryAddresses) {
              geopoint_to_update[pub_list.DeliveryAddresses[address_key].GeopointKey] = {};
            }
            promises.push(
              admin.database().ref("geopoints").update(geopoint_to_update).then(function () {
                console.log("All geopoints removed. ");
              }).catch((err) => {
                console.warn("Cannot remove geopoint: " + err.message);
              })
            );

            return Promise.all(promises).then(() => {
              console.log("All done:shopper data, chosen address, accepted, geopoints");
              return;
            });


          }).catch((err) => {
            console.warn("Cannot retrieve candidate: " + err.message);
            return;
          });

        }).catch((err) => {
          console.warn("Cannot retrieve candidate: " + err.message);
          return;
        });

      } else {
        return;
      }

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }

  });


// Terminates list when payment is done.
// Moves list from published_lists to terminated_lists (both for shopper and demander). 
exports.terminateList = functions.database.ref('/published_lists/{userId}/{listId}')
  .onWrite(event => {

    try {

      let uid = event.params.userId;
      let list_key = event.params.listId;
      let pub_list = event.data.val();

      if (event.data.exists() && event.data.child('TerminatedDate').exists() && !event.data.child('TerminatedDate').previous.exists()) {

        return once(admin.database().ref('/candidates/' + uid)).then(candidates => {

          let promises = [];

          for (let candidateKey in candidates) {
            let candidate = candidates[candidateKey];
            if (candidate.ListReferenceKey == list_key) {
              promises.push(
                admin.database().ref('/candidates/' + uid + '/' + candidateKey).remove()
              );
              promises.push(
                admin.database().ref('/candidatures/' + candidate.uid + '/' + candidate.CandidatureReferenceKey).remove()
              );
            }
          }

          pub_list.ReviewLeft = false;
          for (let addressKey in pub_list.DeliveryAddresses) {
            if (pub_list.DeliveryAddresses[addressKey].Chosen != true) {
              delete pub_list.DeliveryAddresses[addressKey];
            }
          }

          promises.push(
            admin.database().ref('/terminated_lists/' + uid + '/as_demander/' + list_key).set(pub_list).then(() => {
              console.log("Copied list in terminated_lists for demander.");
            }).catch(err => {
              console.warn("Cannot copy to terminated_lists for demander: " + err.message);
              return;
            })
          );

          promises.push(
            admin.database().ref('/terminated_lists/' + pub_list.ChosenShopperUid + '/as_shopper/' + list_key).set(pub_list).then(() => {
              console.log("Copied list in terminated_lists for shopper.");
            }).catch(err => {
              console.warn("Cannot push to terminated_lists for shopper: " + err.message);
              return;
            })
          );

          promises.push(
            admin.database().ref('/published_lists/' + uid + '/' + list_key).remove().then(() => {
              console.log("List removed from published_lists.");
            }).catch(err => {
              console.warn("Cannot remove published_lists: " + err.message);
              return;
            })
          );

          return Promise.all(promises).then(() => {
            console.log("All done.");
          });

        });

      } else {
        return;
      }

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }

  });



// Move review from reviewer to reviewee
exports.moveReview = functions.database.ref('/reviews/{userId}/to_move/{reviewId}')
  .onWrite(event => {

    if (event.data.exists() && !event.data.previous.exists()) {

      let review = event.data.val();

      let promises = [];

      promises.push(
        admin.database().ref('/reviews/' + review.RevieweeUid + '/done').push(review).then(() => {
          console.log("Review moved");
        })
      );

      promises.push(
        event.data.ref.remove().then(() => {
          console.log("Review removed from reviewer");
        })
      );

      return Promise.all(promises).then(() => {
        console.log("All done");
      });

    } else {
      return;
    }

  });



// OLD CODE

// Parameters: list_key, token
// - list_key: chiave della lista unpublished da pubblicare
// - token
//exports.publishList = functions.https.onRequest((req, res) => {

    //let idToken = req.query.token;
    //console.log("validating token: " + idToken);

    // result object. Must contain two properties:
    // - error: boolean indicating is the request has failed
    // - errorMessage: string, empty if boolean is true
    //let result = {};
    //result.error = true;
    //result.errorMessage = "";

    //admin.auth().verifyIdToken(idToken)
    //.then(function (decodedToken) {
    //let uid = decodedToken.uid;
    //console.log("Token validated: " + uid);
    //let list_key = req.query.list_key;
    //if (list_key == null || list_key == "") {
    //  console.warn("Null list_key");
    //  result.error = true;
    //  result.errorMessage = "Null list_key";
    //  res.send(200, JSON.stringify(result));
    //} else {
    //return once(admin.database().ref('/unpublished_lists/' + uid + '/' + list_key)).then(unpub_list => {
    //return event.data.ref.parent.once("value", (_unpub_list) => {