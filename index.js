'use strict'

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const fs = require('fs');
const moment = require('moment');
const momentTZ = require('moment-timezone');
const uuid = require('node-uuid');
const app = express()
const aws = require('aws-sdk');
const srequest = require('sync-request');
const S3_BUCKET = process.env.S3_BUCKET;
const S3_BUCKET_IMG = process.env.S3_BUCKET_IMG;
const s3 = new aws.S3({signatureVersion: 'v4'});
const credentials = require('./credentials');
var bucket = 'psbot-personal-stylist-bot';
var myBucket = `${bucket}-logs`;
var myBucketImgs = `${bucket}-imgs`;
var userInfoBucket = `${bucket}-user-info`;
var userInfoFile = "userInfo.txt";
var Bitly = require('bitly');
var userRatingBucket = `${bucket}-rating`;
//MAKE SURE USING CORRECT TOKEN
const fbToken = credentials.fbToken.kv;
const bitlyToken = "26854408873b067c291d76f7f0d7c9119a520989";
var bitly = new Bitly(bitlyToken);
var validator = require('validator');


//date tracking
const serverStartTime = Date.now();
let days = 0; //days since the serverStartTime
let milisecOneDay = 1000 * 60 * 60 * 24;
// let milisecOneDay = 1000 * 60; //--for testing
let startTime = serverStartTime; //start time of the current date
let numOneDayUserRequest = 0; 
let numOneDayUniqUser = 0;
let numOneDayReturnUser = 0;

//fires every new day
function newDay(){
  numOneDayUserRequest = 0;
  numOneDayUniqUser = 0;
  numOneDayReturnUser = 0;
  startTime = serverStartTime + milisecOneDay * (days);
  days++;
  console.log("newDay", startTime);
  saveObjToS3(JSON.stringify(userInfoMap), userInfoFile, userInfoBucket, getObjFromS3.bind(null, userInfoFile, userInfoBucket, getUserInfo));
  setTimeout(newDay, milisecOneDay);
}
newDay();

//all wizards
const wizards = []

//list of all stylists who ever logged in
const stylistlist = []

//current user-wizard pairs
const userWizardPairs = {}


//--------------------------
//A map for tracking user-wizard conversation
const userInfo = {}
//add new user info
function addUserInfo(userid, text){
  userid = userid.toString();
  if (!(userid in userInfo)) {
    userInfo[userid] = {};
    userInfo[userid]['startTime'] = +new Date();
    userInfo[userid]['mostRecentTime'] = userInfo[userid]['startTime'];
    userInfo[userid]['numMessages'] = 1;
    userInfo[userid]['conversationHistory'] = text + "\n";
    numOneDayUserRequest++;
    console.log("new request", numOneDayUserRequest);
  } else {
    console.log("old request numOneDayUserRequest", userInfo[userid]['mostRecentTime'] < startTime, userInfo[userid]['mostRecentTime'], startTime);
    if(userInfo[userid]['mostRecentTime'] < startTime){ //if the last request time is before today, the current request should be counted as a new request for today
      numOneDayUserRequest++;
    }
    userInfo[userid]['mostRecentTime'] = +new Date();
    userInfo[userid]['numMessages'] += 1;
    userInfo[userid]['conversationHistory'] += text + "\n";
  }
  
}
//remove user info
function clearUserInfo(userid){
  console.log("userInfo delete");
  userid = userid.toString();
  delete userInfo[userid];
}


//--------------------------
//A map for tracking the timing of user requests
var userInfoMap = {};
//UserInfo class for each user
function UserInfo(id, latestVisit) {
  this.id = id;
  this.latestVisit = latestVisit;
  this.numDaysVisited = 1;
  this.conversationTiming = [];
}
//init UserInfoMap
function userInfoMapInit(data){
  if(data) {
    userInfoMap = data;
  } else {
    userInfoMap = {};
  }
}
//add new user to the map
function addNewUser(id, latestVisit, todayStart){
  if(!userInfoMap[id]){
    let newUser = new UserInfo(id, latestVisit);
    //Object.defineProperty(userInfoMap, id, {value:newUser, writable:true});
    userInfoMap[id] = newUser;
    userInfoUpdate(id, latestVisit, todayStart);
    return true;
  } else {
    return false;
  }
}
//update userInfo by id in the UserInfoMap
function userInfoUpdate(id, latestVisit, todayStart){
  let prevVisit = userInfoMap[id].latestVisit;
  userInfoMap[id].latestVisit = latestVisit;
  if(prevVisit < todayStart){
    userInfoMap[id].numDaysVisited++;
  }
  return {
    prevVisit: prevVisit,
    latestVisit: latestVisit
  };
}
//get user info from file
function getUserInfo(data){
    var jsonData;
    if(data.length !== 0){
      jsonData = JSON.parse(data);
    }
    jsonData = null;
    //console.log("getuserinfo", jsonData);
    userInfoMapInit(jsonData);
  
}
//record start time of conversation with wizard
function userInfoStartWizardConversation(id) {
  userInfoMap[id].conversationTiming.push({start: +new Date(), end: undefined});
}
//record end time of conversation with wizard
function userInfoEndWizardConversation(id) {
  let conversationIndex = userInfoMap[id].conversationTiming.length-1;
  userInfoMap[id].conversationTiming[conversationIndex].end = +new Date();
}


//----------------
//user waitinglist queue
function UserQueue() {
    this.queue = [];
}
UserQueue.prototype.push = function(item){return this.queue.push(item);}
UserQueue.prototype.pop = function(){return this.queue.shift();}
UserQueue.prototype.empty = function(){return this.queue.length === 0;}
UserQueue.prototype.find = function(item){return this.queue.indexOf(item);}
UserQueue.prototype.peak = function(){return this.queue[0];}
UserQueue.prototype.remove = function(item){
  let index = this.queue.indexOf(item);
  if(index !== -1){
    this.queue.splice(index, 1);
    return true;
  }
  return false;
}
UserQueue.prototype.length = function(){return this.queue.length;}
const userQueue = new UserQueue();


//setting port
app.set('port', (process.env.PORT || 5000))

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}))

// Process application/json
app.use(bodyParser.json())

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] === 'my_voice_is_my_password_verify_me') {
        res.send(req.query['hub.challenge'])
    }
    res.send('Error, wrong token')
})

// Spin up the server
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
})


app.post('/webhook/', function (req, res) {
    let messaging_events = req.body.entry[0].messaging
    for (let i = 0; i < messaging_events.length; i++) {
      let event = req.body.entry[0].messaging[i]
      let sender = event.sender.id

      //check if the event is a message
      let text = "";
      if (event.message && event.message.text) {
          text = event.message.text;
          let code = text.substring(0,4);
          if(code == "SMTS") {// want to send a notification to all stylists
            sendNotification(text.substring(5));
            continue;
          }
          if(checkForText("secretAdmin", text)){ //get general info 
            console.log("secretAdmin");
            let freeWizards = 0;
            for(let i = 0; i<wizards.length; i++){
              if(userWizardPairs[wizards[i]])
                continue;
              else
                freeWizards++;
            }
            let text = `number of users online:${userQueue.length()}\nnumber of stylists online:${wizards.length}\nnumber of free stylists: ${freeWizards}\nnumber of user request today: ${numOneDayUserRequest}\nnumber of unique users today: ${numOneDayUniqUser}\nnumber of returning users: ${numOneDayReturnUser}`;
            directBackAndForth(sender, text);
        }
      }

       //if quick reply was clicked check if it was the user rating
      if (event.message && event.message.quick_reply) {
        text = event.message.quick_reply.payload;
        
        if(text.substring(0,6) === 'rating' && text.length === 62 ) {
          let stylist = text.substring(15,31);
          let user = text.substring(37,53);
          let rating = text.substring(61,62);
          directBackAndForth(sender, "Thanks for the feedback!");
          saveRatingToS3(stylist,user,rating);
        }
        continue;
      }

      if(!checkForText("secretAdmin", text)){
        if(userWizardPairs[sender]){ //if sender is paired up
          let fileName = "";
          let label = "";
          if(isWizard(sender,wizards)) { //the sender is a wizard
            console.log(sender, userWizardPairs[sender], text);
            fileName  = getFilename(userWizardPairs[sender]);
            label = "w";
          } else {
            fileName = getFilename(sender);
            label = "u";
          }
          if(isWizard(sender, wizards) && req.body.entry[0].messaging[i].postback){ //when paried wizard click button 
                text = event.postback.payload
                let type = text.charAt(0);
                let userid = parseInt(text.substring(1,text.length));
                let wizard = sender;
                let client = userWizardPairs[sender];
                if(checkForText("STOP",text) || checkForText("CLEAR",text)){
                    directBackAndForth(wizard, "Thanks for helping! This conversation is over.");
                    directBackAndForth(wizard, "You are still logged in as a stylist. To logout type menu");
                    sendGoodbye(wizard,client);
                    saveToS3(fileName);
                    clearUserInfo(client);
                    clearPair(wizard, client);

                    if(checkForText("CLEAR",text)){
                      removeWizard(wizard,wizards);
                      directBackAndForth(wizard, "Thanks for helping! You're logged off now");
                    } //stopped but not cleared
                    else{
                      checkWaitingUsers(userQueue,wizards,sender,text);
                    }
                } else if(text.length == 16) {
                  // wizard Request
                  directBackAndForth(wizard, "You are already logged in as a stylist");
                  //check for waiting users
                  checkWaitingUsers(userQueue,wizards,wizard,text);
                }
          }
          var shouldSendMessage = true;
          if(isWizard(sender,wizards) && event.message && event.message.text){ // when paired wizard send text
            var wizardText = event.message.text;
            if(checkForText("menu", wizardText) || checkForText("Menu", wizardText) || checkForText("MENU", wizardText)){
                  let wizard = sender;
                  userInfoEndWizardConversation(userWizardPairs[wizard]);
                  wizConvoMenu(wizard, sender, text.substring(0, 200), "END conversation", "STOP");
                  shouldSendMessage = false;
            }
          }
          if(shouldSendMessage){
            if(event.message && event.message.text){
              writeTextToFile(fileName, text, label);
              directBackAndForth(userWizardPairs[sender],  text);
            }
            else if(event.message && event.message.attachments) {
              console.log("recognized attachment");
              directBackAndForthAttachment(userWizardPairs[sender], event.message.attachments[0].type, event.message.attachments[0].payload,fileName,label);
            }
          }
        } else { //sender is not paired up
          if(isWizard(sender,wizards)){//sender is a wizard
              if (req.body.entry[0].messaging[i].postback) { //if wizard click the button
                text = event.postback.payload
                let type = text.charAt(0);

                let userid = parseInt(text.substring(1,text.length));
                if( isWizard(userid.toString(), wizards) || userWizardPairs[userid]){  //if the user has already been claimed by other wizard or the user is now a wizard
                    directBackAndForth(sender, "Another stylist is already working with that user, thanks though!");
                    checkWaitingUsers(userQueue, wizards, sender, text);
                } else if (type == 'r'){ //wizard clicked the reject button
                    let successRemoveUser = userQueue.remove(userid.toString());
                    if(successRemoveUser){
                      directBackAndForth(sender, "Successfully removed the user");
                      clearUserInfo(userid);
                    } else {
                      directBackAndForth(sender, "The user is claimed/removed by another stylist already.");
                    }
                    checkWaitingUsers(userQueue, wizards, sender, text);
                } else if(checkForText("STOP",text) || checkForText("CLEAR",text)){ //wizard sign off
                    if(checkForText("CLEAR",text)){
                      let wizard = sender;
                      removeWizard(wizard,wizards);
                      directBackAndForth(wizard, "Thanks for helping! You're logged off now");
                    } //stopped but not cleared
                    else{
                      checkWaitingUsers(userQueue,wizards,sender,text);
                    }
                } else if (type=='c') { //wizard clicked the claim button
                  if(userQueue.peak() && userQueue.peak().toString() == userid.toString()){
                    console.log("wizard claims a user");
                    userQueue.pop();
                    createPair(sender, userid);
                    userInfoStartWizardConversation(userid);
                    sendRequestDetailsToWizard(sender,userid);
                    informWaitingUsers(userQueue);
                  } else {
                    directBackAndForth(sender, "The user request is rejected by another stylist, thanks though!");
                    console.log("user request is rejected by another wizard")
                  }    
                }
              } else if (checkForText("menu", text) || checkForText("Menu", text) || checkForText("MENU", text)){ //wizard wants the menu panel
                let wizard = sender;
                wizConvoMenu(wizard, sender, text.substring(0, 200), "Stylist LOG OFF", "CLEAR");
              } else {
                //if wizard sending a message, not taken
                console.log("Wizards cannot initiate a conversation");
              }
          } else if(checkForText("style247", text) || checkForText("Style247", text) || checkForText("STYLE247", text)){ //sender is a user, type "style247" to get the panel
            let wizard = sender;
            initialWizardPanel(wizard, sender, text.substring(0, 200));
          } else if(req.body.entry[0].messaging[i].postback){ //ender is a user, click the panel from "style247"
            text = event.postback.payload;
            let type = text.charAt(0);
            let wizard = sender;
            wizards.push(wizard);
            //if the stylist is logging in for the fisrt time add the userid to the stylistlist
            if(stylistlist.indexOf(wizard)<0){
              stylistlist.push(wizard);
            }
            userQueue.remove(wizard);//if the wizard was a user before, remove it
            directBackAndForth(wizard, "Congrats! You are now a stylist");
            //check for waiting users
            checkWaitingUsers(userQueue,wizards,wizard,text);
            console.log("no user available for pair up");
          } else { //sender is a user, ask all available wizards
              const isNewUser = addNewUser(sender, Date.now(), startTime);
              if(isNewUser){
                numOneDayUniqUser++;
              } else {
                const timeInfo = userInfoUpdate(sender, Date.now(), startTime);
                if(timeInfo.prevVisit < startTime){
                  numOneDayUniqUser++;
                  numOneDayReturnUser++;
                }
              }
              addUserInfo(sender, text);
              if(userQueue.empty()){ //if no one is waiting in front of the user, check availability of wizards and push user into the queue
                  userNeedToWait(sender);
                  for (let wizard of wizards){
                      if(!userWizardPairs[wizard]){ // wizard is available
                          startWizards(wizard, sender, text.substring(0, 200));
                      }
                  }
              } else { //if someone is waiting, simply push
                  userNeedToWait(sender);
              }
          }
        }
      }     
    }
    res.sendStatus(200)
})



function checkForText(seekText,fullText) {
  if(fullText.indexOf(seekText) != -1){
    return true;
  } else {
    return false;
  }
}


function isWizard(user,wizards) {
  if (wizards.length > 0) { // first there have to be at least some wizards
    if(wizards.indexOf(user) != -1) {
        return true;
    } else {
        return false;
    }
  } else { // if there are no wizards, this person is automatically not a wizard
        return false;
  }
}

function removeWizard(wizard,wizards){
  var index = wizards.indexOf(wizard);
  if (index > -1) {
      wizards.splice(index, 1);
  }
}

function checkWaitingUsers(userQueue,wizards,wizard,text) {
  if(!userQueue.empty()){
    let user = userQueue.peak();
    startWizards(wizard, user, "new user request");
  }
  else {
    directBackAndForth(wizard,"There is no one in the queue right now!");
  }
}

//test
function writeTextToFile(fileName, text, label){
  let logDir = './logs';
  if(!fs.existsSync(logDir)){
    fs.mkdirSync(logDir);
    if(!fs.existsSync(logDir)){
      console.log("create directory failed");
    }
  }

  let directory =`${logDir}/${fileName}`;
  let fulltext = `${label}:${+new Date()}: ${text}\n`;
  fs.appendFile(directory, fulltext , function(err){
    if (err) throw err;

    console.log("writeTextToFile", directory, ",text: ", fs.readFileSync(directory, 'utf8'));
  });
}

//sending goodbye message to the user after the conversation has ended.
function sendGoodbye(wizard,user) {

    request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token:fbToken},
      method: 'POST',
      json: {
          recipient: {id:user},
          message: {text:"Bye!"},
        }
      }, function(error, response, body) {
          if (error) {
              console.log('Error sending messages: ', error)
          } else if (response.body.error) {
              console.log('Error: ', response.body.error)
            }
          else {
            request({
              url: 'https://graph.facebook.com/v2.6/me/messages',
              qs: {access_token:fbToken},
              method: 'POST',
              json: {
                  recipient: {id:user},
                  message: {text:"-- Conversation has ended --"},
                }
          }, function(error, response, body) {
              if (error) {
                  console.log('Error sending messages: ', error)
              } else if (response.body.error) {
                  console.log('Error: ', response.body.error)
              }
              else
                sendSurvey(wizard,user);
          });
        }
    });
}


// remove the pair between wizard and user
function clearPair(wizard, user){
    delete userWizardPairs[wizard];
    delete userWizardPairs[user];
}

function userNeedToWait (user){
    let waitingListNum = userQueue.find(user);
    let text = "";
    if(waitingListNum !== -1){ //if already in the user queue
       waitingListNum = waitingListNum + 1;
       var timeDiff = Math.abs(userInfo[user]['mostRecentTime'] - userInfo[user]['startTime']);
       if (timeDiff > 30000) {
          text = `Sorry, I'm still working--but you are #${waitingListNum} in line`;
          directBackAndForth(user, text);
       } else if (timeDiff < 30000 && userInfo[user]['numMessages'] == 2) {
          text = `Happy to help with that! Anything else you'd like to add?`;
          directBackAndForth(user, text);
       }
    } else { // check if someone is waiting in the queue
      let time = moment().tz('America/Chicago').format('HH');
      console.log('time:'+time);
      if(time<'09' || time>'17') {
        text = "Sorry! We're not available right now. Our hours of operation are 9am - 5pm CST. We'll get back to you as soon as we can!";
        directBackAndForth(user, text);
        waitingListNum = userQueue.push(user) -1;
      }
      else {
        let consentForm = "By using PSBot, you're consenting to participate in this research study - http://bit.ly/2jQIXQK";
        text = "I’m getting ready — can you describe what you’d like help with?";
        waitingListNum = userQueue.push(user) -1;
        directBackAndForth(user, consentForm);
        directBackAndForth(user, text);
        var QueueLength = userQueue.length()
        var freeWizards = 0
        for(let i = 0; i<wizards.length; i++){
          if(userWizardPairs[wizards[i]])
            continue;
          else
            freeWizards++;
        }
        for(let i = 0; i<wizards.length; i++) {
          directBackAndForth(wizards[i], "Number of people in the queue = " + QueueLength + ", Number of free stylists = "+freeWizards+", Total number of stylists = "+wizards.length);
        }
      }
    }
}

//get request to get the user's perosnal information
function getUserData(sender) {
  var userMetadata = {};
  var res = srequest('GET', 'https://graph.facebook.com/v2.6/'+sender, {
    qs: {
      access_token: fbToken,
      fields: 'first_name,last_name,locale,timezone,gender,profile_pic'
    }
  });
  var data = JSON.parse(res.getBody('utf8'));

  var lookup = { '-5':'Central US', '-4':'Eastern US', '-6':'Mountain', '-7':'Pacific'};
  console.log(data);
  if(data['first_name'] && data['last_name'] && data['gender'] && data['locale'] && data['timezone'])
    var tz = "International";
    if(lookup[data['timezone'].toString()])
      tz = lookup[data['timezone'].toString()];
    userMetadata = {
      first_name: data['first_name'],
      last_name: data['last_name'],
      gender: data['gender'],
      locale: data['locale'],
      timezone: tz,
      profile_pic: data['profile_pic']
    }
  return userMetadata;
}

// initial wizard panel
function initialWizardPanel(wizard, sender, text) {
     //let messageData = { text: sender + "writes: " + text}
    let messageData = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": text,
                "buttons": [{
                    "type": "postback",
                    "title": "Stylist LOG IN",
                    "payload": (sender)
                }
                ]
            }
        }
    }

    //let messageData = { text: sender + " writes: " + text}
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:fbToken},
        method: 'POST',
        json: {
            recipient: {id:wizard},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

//menu for wizards to end conversation or log off
function wizConvoMenu(wizard, sender, text, buttonTitle, payload){
    //let messageData = { text: sender + "writes: " + text}
    let messageData = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": text,
                "buttons": [{
                    "type": "postback",
                    "title": buttonTitle,
                    "payload": payload
                }
                ]
            }
        }
    }

    //let messageData = { text: sender + " writes: " + text}
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:fbToken},
        method: 'POST',
        json: {
            recipient: {id:wizard},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

//send user request to wizard
function startWizards(wizard, sender, ignoretext) {
    var text = "User wrote:\n" + userInfo[sender]['conversationHistory'];
    let messageData = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": text,
                "buttons": [{
                    "type": "postback",
                    "title": "CLAIM USER",
                    "payload": 'c'+sender
                },
                {
                    "type": "postback",
                    "title": "DELETE USER",
                    "payload": 'r'+sender
                }]
            }
        }
    }

    //let messageData = { text: sender + " writes: " + text}
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:fbToken},
        method: 'POST',
        json: {
            recipient: {id:wizard},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

// send the initial messages the user wrote to the wizard (also save them to file)
function sendRequestDetailsToWizard(wizard,user) {
  var fileName = getFilename(user);
  let label = "u";
  var text = userInfo[user]['conversationHistory'];
  var userMetadata = getUserData(user);
  var strData = JSON.stringify(userMetadata);
  console.log("data to String", strData);

  console.log("history", text);

  directBackAndForth(wizard, "paired up with "+user);
  directBackAndForth(wizard, "User wrote:\n" + text);
  if(userMetadata!="")
    sendUserDataToWizard(wizard, userMetadata);
  writeTextToFile(fileName, text, label);
  writeTextToFile(fileName, strData, label);
}

function getFilename(user) {
  console.log("getFilename",user);
  var fileName = user + "_" + userInfo[user]['startTime'] + ".txt";
  return fileName;
}

//creating pair between wizard and user
function createPair(wizard,user) {
  userWizardPairs[wizard] = user
  userWizardPairs[user] = wizard
}

function informWaitingUsers(userQueue){
  console.log("informing users");
  for (let user of userQueue.queue){
      let waitingListNum = userQueue.find(user);
      waitingListNum = waitingListNum + 1;
      var text = `Thanks for sticking around! You are now #${waitingListNum} in line`;
      directBackAndForth(user, text);
  }
}

function sendUserDataToWizard(messageRecipient, userMetadata){
  let messageData = {
    "attachment": {
      "type": "template",
      "payload":{
        "template_type": "generic",
        "image_aspect_ratio": "square",
        "elements":[
          {
            "title": userMetadata.first_name + " " + userMetadata.last_name,
            "image_url": userMetadata.profile_pic,
            "subtitle": userMetadata.gender + ", "+userMetadata.locale+ ", "+ userMetadata.timezone
          }
        ]
      }
    }
  }
  request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token:fbToken},
    method: 'POST',
    json: {
        recipient: {id:messageRecipient},
        message: messageData,
    }
  }, function(error, response, body) {
    if(error){
      console.log('Error sending messages: ', error)
    } else if (response.body.error) {
      console.log('Error: ', response.body.error)
    }
  })
}


function directBackAndForthAttachment(messageRecipient, type, payload,fileName,label) {
    console.log("sending attachement");
    var imgFilename = uuid.v4().toString();
    var imgNameText = imgFilename;
    writeTextToFile(fileName, imgNameText, label);
    // console.log("testfilename = " + imgFilename);
    // console.log("img url = " + payload.filedata);
    saveImgToS3(imgFilename,payload);
    let messageData = {
        "attachment":{
            "type": type ,
            "payload": payload
        }
    }

    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:fbToken},
        method: 'POST',
        json: {
            recipient: {id:messageRecipient},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

function directRequest(messageRecipient,messageData) {
  request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token:fbToken},
      method: 'POST',
      json: {
          recipient: {id:messageRecipient},
          message: messageData,
        }
  }, function(error, response, body) {
      if (error) {
          console.log('Error sending messages: ', error)
      } else if (response.body.error) {
          console.log('Error: ', response.body.error)
      }
  })

}

function directBackAndForth(messageRecipient, text) {
    //console.log("message from bot");
    let messageData = {};
    if (validator.isURL(text)) { //=> text is a URL
      bitly.shorten(text).then(function(response) { // force to wait on API or big problems (urls just disappear)
        var shortText = response.data.url;
        messageData = { text: shortText};
        directRequest(messageRecipient,messageData);
      }, function(error) {
        throw error;
      });
    } else {
      messageData = { text:text}; //test
      directRequest(messageRecipient,messageData);
    }
}

//get an object from S3
function getObjFromS3(fileName, bucket, callback){
  let params = {Bucket: bucket, Key:fileName};
  s3.getObject(params, function(err, data){
    if(err){
      console.error("getObjFromS3 err",err);
    } else {
      callback(data.Body.toString('utf-8'));
    }
    
  });

}

//save an object to S3
function saveObjToS3(data, fileName, bucket, callback){
  console.log("saveObjToS3", data);
  //save data to s3  
  var params = {Bucket: bucket, Key: fileName, Body: data, ContentType: 'text/plain'};
  s3.putObject(params, function(err, data) {
    if (err) {
      console.log("saveObjToS3 err", err);
    } else {
      callback();
    }
  });
}

//save a file to S3
function saveToS3(fileName) {
  // load in file;
  let logDir = './logs';
  let directory =`${logDir}/${fileName}`;
  let myKey = fileName;
  var myBody;
  console.log(directory);

  // read then save to s3 in one step (so no undefined errors)
  fs.readFile(directory, (err, data) => {
          if (err) throw err;
          myBody = data;
          console.log("save to s3 data is " + data);
          var params = {Bucket: myBucket, Key: myKey, Body: myBody, ContentType: 'text/plain'};
          s3.putObject(params, function(err, data) {
          if (err) {
              console.log(err)
          } else {
              console.log("Successfully uploaded data to myBucket/myKey");
          }
          });

  });
  fs.unlink(directory);

  // the create bucket stuff started to cause problems (error: "BucketAlreadyOwnedByYou: Your previous request to create the named bucket succeeded and you already own it.")
  // so I pulled it all out
}

function saveImgToS3(myKey,image) {

  // pull from URL now
  request({
          url: image.url,
          encoding: null
      }, function(err, res, body) {
          if (err)
              return callback(err, res);

          var params = {Bucket: myBucketImgs, Key: myKey, Body: body, ContentType: res.headers['content-type'], ContentLength: res.headers['content-length']};
          s3.putObject(params, function(err, data) {
              if (err) {
                  console.log(err)
              } else {
                  console.log("Successfully uploaded data to myBucketImgs/myKey");
              }
          });
      })
}

//sending a broadcast notification to all stylists
function sendNotification(text) {
  let notification = "New Notification: "+text;
  for(let i = 0; i<stylistlist.length; i++) {
    directBackAndForth(stylistlist[i], notification);
  }
}

function sendSurvey(wizard, sender) {
    var text = "How satsfied were you with your experience? Rate us out of 5.";
    var payloadText = "rating stylist:" + wizard + " user:" + sender + " number:";
    let messageData = {
      "text": text,
      "quick_replies":[
        {
          "content_type":"text",
          "title":"1",
          "payload":payloadText+1,
        },
        {
          "content_type":"text",
          "title":"2",
          "payload":payloadText+2,
        },
        {
          "content_type":"text",
          "title":"3",
          "payload":payloadText+3,
        },
        {
          "content_type":"text",
          "title":"4",
          "payload":payloadText+4,
        },
        {
          "content_type":"text",
          "title":"5",
          "payload":payloadText+5,
        }       
      ]
    };

    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:fbToken},
        method: 'POST',
        json: {
            recipient: {id:sender},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

function saveRatingToS3(stylist, user, rating) {
  let fulltext = "stylist: "+stylist+" user:"+user+" rating:"+rating;
  let fileName = user+".txt";

  var params = {Bucket: userRatingBucket, Key: fileName, Body: fulltext, ContentType: 'text/plain'};
  s3.putObject(params, function(err, data) {
    if (err) {
      console.log("saveObjToS3 err", err);
    } else {
      console.log("saved user rating");
    }
  });
}