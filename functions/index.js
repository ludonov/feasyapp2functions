require('@google-cloud/debug-agent').start({ allowExpressions: true });
const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// Publish a list. Moves it from unpublished_lists to published_lists and publishes geopoints
// Parameters: list_key, token
// - list_key: chiave della lista unpublished da pubblicare
// - token
exports.publishList = functions.https.onRequest((req, res) => {

  var idToken = req.query.token;
  console.log("validating token: " + idToken);

  // result object. Must contain two properties:
  // - error: boolean indicating is the request has failed
  // - errorMessage: string, empty if boolean is true
  var result = {};
  result.error = true;
  result.errorMessage = "";

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
      if (list_key == null || list_key == "") {
        console.warn("Null list_key");
        result.error = true;
        result.errorMessage = "Null list_key";
        res.send(200, JSON.stringify(result));
      } else {
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
      }
    }).catch(function (error) {
      console.warn("Token NOT validated: " + error);
      result.error = true;
      result.errorMessage = "Token NOT validated: " + error;
      res.send(200, JSON.stringify(result));
    });

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
      var candidature = event.data.val();
      console.log('Caught candidature of user: <' + event.params.userId + '> with key <' + event.params.candidatureId + '>');

      var ListOwnerUid = candidature.ListOwnerUid;
      var ListReferenceKey = candidature.ListReferenceKey;
      var AddressKey = candidature.AddressKey;
      var Comment = candidature.Comment;
      console.log('ListOwnerUid: ' + ListOwnerUid);
      console.log('ListReferenceKey: ' + ListReferenceKey);
      console.log('AddressKey: ' + AddressKey);
      console.log('Comment: ' + Comment);

      var new_candidate = {};
      new_candidate.uid = event.params.userId;
      new_candidate.ListReferenceKey = ListReferenceKey;
      new_candidate.AddressKey = AddressKey;
      new_candidate.CandidatureReferenceKey = event.params.candidatureId;
      new_candidate.Visualised = false;
      new_candidate.Comment = Comment || "";

      return admin.database().ref('/users/' + event.params.userId + '/DisplayName').ref.once("value", _name => {
        var user_name = _name.val();
        new_candidate.DisplayName = user_name;
        console.log('DisplayName: ' + user_name);
        return admin.database().ref('/candidates/' + ListOwnerUid).push(new_candidate);
      });

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }
  });


// When a candidate is chosen by the demander, automatically set <Accepted=true> to shopper's candidature
// Removes list from the map (geopoints)
exports.acceptCandidate = functions.database.ref('/published_lists/{userId}/{listId}/ChosenCandidateKey')
  .onWrite(event => {

    try {
      // Only edit data when it is first created or changes from empty to some value.
      if ((event.data.previous.val() == "" || !event.data.previous.exists()) && event.data.exists()) {

        // Grab the current value of what was written to the Realtime Database.
        var acceptedCandidateKey = event.data.val();
        console.log('Candidate <' + acceptedCandidateKey + '> accepted for list <' + event.params.listId + '> of user <' + event.params.userId + '>');

        //console.log('/candidates/' + event.params.userId + '/' + acceptedCandidateKey);
        return admin.database().ref('/candidates/' + event.params.userId + '/' + acceptedCandidateKey).ref.once("value", _candidate => {
          var candidate = _candidate.val();
          //console.log("candidate: " + JSON.stringify(candidate));
          console.log('Updating ChosenShopperUid and ChosenCandidatureKey...');
          return admin.database().ref('/published_lists/' + event.params.userId + '/' + event.params.listId).update({ ChosenCandidatureKey: candidate.CandidatureReferenceKey, ChosenShopperUid: candidate.uid }).then(() => {
            console.log("Updated. Setting Accepted=true for shopper's candidature...");
            return admin.database().ref('/candidatures/' + candidate.uid + '/' + candidate.CandidatureReferenceKey + '/Accepted').set(true).then(() => {
              console.log("Shopper set as Accepted. Removing geopoints...");
              return event.data.ref.parent.once("value", (_pub_list) => {
                var pub_list = _pub_list.val();
                var counter = 0;
                var num_addresses = Object.keys(pub_list.DeliveryAddresses).length;
                for (let address_key in pub_list.DeliveryAddresses) {
                  var geoKey = pub_list.DeliveryAddresses[address_key].GeopointKey;
                  return admin.database().ref("geopoints/" + GeopointKey).remove().then(function () {
                    counter++;
                    if (counter >= num_addresses) {
                      console.log("Final step done: all geopoints removed. ");
                      return;
                    }
                  }).catch((err) => {
                    console.warn("Cannot remove geopoint: " + err.message);
                    return;
                  });
                }
              }).catch((err) => {
                console.warn("Cannot retrieve list: " + err.message);
                return;
              });
            }).catch((err) => {
              console.warn("Cannot set accepted to shopper's candidature: " + err.message);
              return;
            });
          }).catch((err) => {
            console.warn("Cannot update: " + err.message);
            return;
          });

        }).catch((err) => {
          console.warn("Cannot retrieve candidate: " + err.message);
          return;
        });
      }

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }

  });


// Terminates list when payment is done.
// Moves list from published_lists to terminated_lists (both for shopper and demander). 
exports.terminateList = functions.database.ref('/published_lists/{userId}/{listId}/TerminatedDate')
  .onWrite(event => {

    try {

      var uid = event.params.userId;
      var list_key = event.params.listId;

      // get list value
      return event.data.ref.parent.once("value", (_pub_list) => {
        var pub_list = _pub_list.val();
        if (pub_list != null) {
          console.log("Copying list in terminated_lists for demander...");
          return admin.database().ref('/terminated_lists/' + uid + '/as_demander/' + list_key).set(pub_list).then(() => {
            console.log("Copying list in terminated_lists for shopper...");
            return admin.database().ref('/terminated_lists/' + pub_list.ChosenShopperUid + '/as_shopper/' + list_key).set(pub_list).then(() => {
              console.log("List copied! removing from published_lists...");
              return admin.database().ref('/published_lists/' + uid + '/' + list_key).remove().then(() => {
                console.log("List removed from published_lists. Removing candidatures and candidates");
                return admin.database().ref('/candidates/' + uid + '/' + list_key).once("value", (_candidates) => {
                  var candidates = _candidates.val();
                  var counter = 0;
                  var num_candidates = Object.keys(candidates).length;
                  for (var candidateKey in candidates) {
                    var candidate = candidates[candidateKey];
                    admin.database().ref('/candidatures/' + candidate.uid + '/' + candidate.CandidatureReferenceKey).remove().then(() => {
                      counter++;
                      if (counter >= num_candidates) {
                        console.log("Candidatures removed. Removing candidates...");
                        return admin.database().ref('/candidates/' + uid + '/' + list_key).remove().then(() => {
                          console.log("All done");
                          return;
                        });
                      }
                    });
                  }
                }).catch(err => {
                  console.warn("Cannot remove published_lists: " + err.message);
                  return;
                });
              }).catch(err => {
                console.warn("Cannot remove published_lists: " + err.message);
                return;
              });
            }).catch(err => {
              console.warn("Cannot push to terminated_lists for shopper: " + err.message);
              return;
            });
          }).catch(err => {
            console.warn("Cannot push to terminated_lists for demander: " + err.message);
            return;
          });
        } else {
          console.warn("Null pub_list");
          return;
        }
      });

    } catch (e) {
      console.warn('Caught error: ' + e);
      return;
    }

  });