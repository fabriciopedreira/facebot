/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  http = require('http'),
  https = require('https'),
  request = require('request'),
  unidecode = require('unidecode'),
  validator = require('validator'),
  natural = require('natural'),
  pug = require('pug');

var tokenizer = new natural.WordTokenizer();
var classifier = new natural.BayesClassifier();

var usersLocationConfirmation=[];

RegExp.escape = function(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

classifier.addDocument("onde agencia", 'find_agencia_nome');
classifier.addDocument("qual agencia", 'find_agencia_nome');
classifier.addDocument("encontrar agencia", 'find_agencia_nome');
classifier.addDocument("localizacao agencia", 'find_agencia_nome');
classifier.addDocument("endereco agencia", 'find_agencia_nome');
classifier.addDocument("localize agencia", 'find_agencia_nome');
classifier.addDocument("onde encontro agencia", 'find_agencia_nome');

classifier.addDocument("agencia cidade", 'find_agencia_cidade');
classifier.addDocument("agencia municipio", 'find_agencia_cidade');
classifier.addDocument("Municipio", 'find_agencia_cidade');
classifier.addDocument("Lista agencia municipio", 'find_agencia_cidade');
classifier.addDocument("Cidade", 'find_agencia_cidade');
classifier.addDocument("Lista agencia cidade", 'find_agencia_cidade');


classifier.addDocument("prefixo", 'find_agencia_prefixo');
classifier.addDocument("Agencia prefixo", 'find_agencia_prefixo');
classifier.addDocument("numero", 'find_agencia_prefixo');
classifier.addDocument("Agencia numero", 'find_agencia_prefixo');
classifier.addDocument("prefixo numero", 'find_agencia_prefixo');
classifier.addDocument("numero prefixo", 'find_agencia_prefixo');

classifier.addDocument("agencia proximo daqui", 'find_agencia_localizacao');
classifier.addDocument("agencia proxima daqui", 'find_agencia_localizacao');
classifier.addDocument("agencia proxima de mim", 'find_agencia_localizacao');
classifier.addDocument("agencia proximo de mim", 'find_agencia_localizacao');
classifier.addDocument("agencia perto daqui", 'find_agencia_localizacao');
classifier.addDocument("agencia perto de mim", 'find_agencia_localizacao');
classifier.addDocument("agencia neste local", 'find_agencia_localizacao');

classifier.addDocument("saldo conta", 'saldo_cc');
classifier.addDocument("saldo poupanca", 'saldo_poupanca');
classifier.addDocument("investimentos", 'investimentos');
classifier.addDocument("cartao", 'cartao');
classifier.addDocument("Seguro", 'seguro');
classifier.addDocument("Recarga", 'recarga');
classifier.addDocument("Saque", 'saque');
classifier.train();

var app = express();

app.set('port', process.env.PORT || 5000);
//app.set('port', 8080);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));
app.set('view engine', 'pug');
app.set('views', 'webviews')

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

const BB_AGENCIAS_API_KEY = config.get('bbAgenciasApiKey');
const GOOGLE_STATICMAP_API_KEY  = config.get('googleStaticMapApiKey');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL && BB_AGENCIAS_API_KEY && GOOGLE_STATICMAP_API_KEY)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query['account_linking_token'];
  var redirectURI = req.query['redirect_uri'];

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});

app.get('/agencia', function (req, res) {
  var prefixo=req.query['prefixo'];
  var options={
    host: 'api-agencias.labbs.com.br',
    path: '/agencias?Numero='+prefixo,
    method: 'GET',
    headers: {apikey:BB_AGENCIAS_API_KEY}
  };
  var requestAPI=http.request(options, (response) => {
    var body='';
    response.on('data', (data) => {
      body+=data;
    });
    response.on('end', (data) => {
      var parsed = JSON.parse(body);
      res.render('agencia', parsed[0]);
    });
  });
  requestAPI.on('error', (e) => {
    console.log(`Got error: ${e.message}`);
  });
  requestAPI.end();

});


/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    switch (messageText) {
      case 'image':
        sendImageMessage(senderID);
        break;

      case 'gif':
        sendGifMessage(senderID);
        break;

      case 'audio':
        sendAudioMessage(senderID);
        break;

      case 'video':
        sendVideoMessage(senderID);
        break;

      case 'file':
        sendFileMessage(senderID);
        break;

      case 'button':
        sendButtonMessage(senderID);
        break;

      case 'generic':
        sendGenericMessage(senderID);
        break;

      case 'receipt':
        sendReceiptMessage(senderID);
        break;

      case 'quick reply':
        sendQuickReply(senderID);
        break;        

      case 'read receipt':
        sendReadReceipt(senderID);
        break;        

      case 'typing on':
        sendTypingOn(senderID);
        break;        

      case 'typing off':
        sendTypingOff(senderID);
        break;        

      case 'account linking':
        sendAccountLinking(senderID);
        break;
        
      case 'mariana':
    	  sendTextMessage(senderID, "Amor da minha vida");
          break;  

      default:
        sendTextMessage(senderID, messageText);
    }
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
  
//  if (messageText) {
//    // If we receive a text message, check to see if it matches any special
//    // keywords and send back the corresponding example. Otherwise, just echo
//    // the text we received.
//    var messageTextASCII = unidecode(messageText).replace(/[^a-zA-Z0-9 ]/g, "").toUpperCase();
//
//    var classification = classifier.classify(messageTextASCII);
//
//    var messageData = {text: messageTextASCII, type:'message'};
//
//    switch (classification) {
//      case 'find_agencia_nome':
//        sendAgenciaMessage(senderID, messageData, classification);
//        break;
//      case 'find_agencia_prefixo':
//        sendAgenciaMessage(senderID, messageData, classification);
//        break;
//
//      case 'find_agencia_cidade':
//        sendAgenciaMessage(senderID, messageData, classification);
//        break;
//      case 'find_agencia_localizacao':
//        sendAgenciaMessage(senderID, messageData, classification);
//        break;
//      default:
//        sendDefaultMessage(senderID);
//    }
//  } else if (messageAttachments) {
//    if (usersLocationConfirmation.indexOf(senderID)>-1 && messageAttachments.length==1 && messageAttachments[0].type == 'location') {
//      var indexUser=usersLocationConfirmation.indexOf(senderID);
//      usersLocationConfirmation.splice(indexUser,1);
//      var location = messageAttachments[0].payload;
//      var messageData = {title:messageAttachments[0].title,latitude:location.coordinates.lat, longitude:location.coordinates.long, raio_metros: 2000, type: 'location'}
//      sendAgenciaMessage(senderID,messageData,'find_agencia_posicao');
//    } else {
//      sendTextMessage(senderID, "Anexo recebido com sucesso!");
//    }
//  }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful

  if (payload.indexOf('AGENCIA')>=0) {
    var messageData={text:payload, type:'message'};
    sendAgenciaMessage(senderID,payload,'find_agencia_prefixo',true);
  } else {
    sendTextMessage(senderID, "Postback called");
  }
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendAgenciaMessage(recipientId, messageReceived, classification, hideHeaderMessage) {

  var messageText = messageReceived.type =='message'? messageReceived.text:undefined;
  var ufToken;
  if (messageText) {
    var tokens=tokenizer.tokenize(messageText);

    ufToken=tokens.find(function(item){
            return ('AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO'.indexOf(item.toUpperCase())>-1);
          });

    if (ufToken) {
      var index=tokens.indexOf(ufToken);
      tokens.splice(index,1);
      messageText=tokens.join(' ');
    }
  }

  var callbackResponse=function(agencias){
    var messageData;
    // SERVER_URL + "/assets/logo.png"
    // https://maps.googleapis.com/maps/api/staticmap?format=png&zoom=13&size=600x400&maptype=roadmap&markers=color:red|-15.799645,-47.882231&key=AIzaSyA4Dt4VSzPe8sQbUCu6mAIzxM1tm7ajoBU
    if (Array.isArray(agencias) && agencias.length>0) {
      if (agencias.length==1) {
        var agencia=agencias[0];
        if (!hideHeaderMessage) {
          sendTextMessage(recipientId,"Foi encontrada a seguinte agência:");
        }

        var buttonsMessage=[{
          type: "web_url",
          url: "https://bot.labbs.com.br/agencia?prefixo=" + agencia.prefixo,
          title: "Detalhar",
          webview_height_ratio: "full",
          messenger_extensions: true
        }, {
          type: "phone_number",
          title: "Ligar para agência",
          payload: "+550" + agencia.cod_fone + agencia.telefone
        }];

        if (classification=="find_agencia_posicao") {
          var userEndereco=encodeURIComponent(messageReceived.title);
          var userLatitude=messageReceived.latitude;
          var userLongitude=messageReceived.longitude;
          //var agenciaNome=encodeURIComponent(agencia.nome);
          var agenciaEndereco=encodeURIComponent(agencia.endereco);
          var agenciaLatitude=agencia.latitude;
          var agenciaLongitude=agencia.longitude;
          var uberButton={
            type: "web_url",
            url: "https://m.uber.com/ul?client_id=T-vjuhXO7GMOvPefPrLi2gbEc1HLapyB&action=setPickup"+
                 "&pickup[latitude]="+ userLatitude+"&pickup[longitude]="+userLongitude+"&pickup[formatted_address]="+ userEndereco +
                 "&dropoff[latitude]="+ agenciaLatitude+"&dropoff[longitude]="+agenciaLongitude+"&dropoff[formatted_address]="+agenciaEndereco+
                 "&product_id=a1111c8c-c720-46c3-8534-2fcdd730040d",
            title: "Vá de Uber"
          };
          buttonsMessage.push(uberButton);
        }

        messageData = {
          recipient: {
            id: recipientId
          },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [{
                  title: agencia.prefixo+" "+agencia.nome,
                  subtitle: agencia.endereco+" - "+agencia.bairro+" - "+agencia.municipio+" - "+agencia.uf,
                  item_url: "https://maps.google.com/?q=" + agencia.latitude+","+agencia.longitude,
                  image_url: "https://maps.googleapis.com/maps/api/staticmap?format=png&scale=2&zoom=15&size=400x300&maptype=roadmap&markers=color:red|" + agencia.latitude + "," + agencia.longitude+"&key="+GOOGLE_STATICMAP_API_KEY,
                  buttons: buttonsMessage
                }]
              }
            }
          }
        };
      } else {
        var elementsArr=[];
        if (agencias.length>10) {
          sendTextMessage(recipientId,"Foram encontradas muitas agências. Limitamos a pesquisa em 10 agências conforme abaixo:");
        } else {
          sendTextMessage(recipientId,"Foram encontradas "+agencias.length+" agências:");
        }
        agencias.slice(0,10).forEach(function(agencia){
            var buttonsMessage=[{
              type: "web_url",
              url: "https://bot.labbs.com.br/agencia?prefixo=" + agencia.prefixo,
              title: "Detalhar",
              webview_height_ratio: "full",
              messenger_extensions: true
            }, {
              type: "phone_number",
              title: "Ligar para agência",
              payload: "+550" + agencia.cod_fone + agencia.telefone
            }];
            if (classification=="find_agencia_posicao") {
              var userEndereco=encodeURIComponent(messageReceived.title);
              var userLatitude=messageReceived.latitude;
              var userLongitude=messageReceived.longitude;
              //var agenciaNome=encodeURIComponent(agencia.nome);
              var agenciaEndereco=encodeURIComponent(agencia.endereco);
              var agenciaLatitude=agencia.latitude;
              var agenciaLongitude=agencia.longitude;

              var uberButton={
                type: "web_url",
                url: "https://m.uber.com/ul?client_id=T-vjuhXO7GMOvPefPrLi2gbEc1HLapyB&action=setPickup"+
                     "&pickup[latitude]="+ userLatitude+"&pickup[longitude]="+userLongitude+"&pickup[formatted_address]="+ userEndereco +
                     "&dropoff[latitude]="+ agenciaLatitude+"&dropoff[longitude]="+agenciaLongitude+"&dropoff[formatted_address]="+agenciaEndereco+
                     "&product_id=a1111c8c-c720-46c3-8534-2fcdd730040d",
                title: "Vá de Uber"
              };
              buttonsMessage.push(uberButton);
            }
            var elementMessage={
              title: agencia.prefixo+" "+agencia.nome,
              subtitle: agencia.endereco+" - "+agencia.bairro+" - "+agencia.municipio+" - "+agencia.uf,
              item_url: "https://maps.google.com/?q=" + agencia.latitude+","+agencia.longitude,
              image_url: "https://maps.googleapis.com/maps/api/staticmap?format=png&scale=2&zoom=15&size=400x300&maptype=roadmap&markers=color:red|" + agencia.latitude + "," + agencia.longitude+"&key="+GOOGLE_STATICMAP_API_KEY,
              buttons: buttonsMessage
            };
            elementsArr.push(elementMessage);
        });

        messageData = {
          recipient: {
            id: recipientId
          },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: elementsArr
              }
            }
          }
        };
      }
      callSendAPI(messageData);
    } else {
      sendDefaultMessage(recipientId);
    }
  };

  var requestAPI = function(options,callback) {
    http.request(options, (response) => {
      var body='';
      response.on('data', (data) => {
        body+=data;
      });
      response.on('end', (data) => {
        var parsed = JSON.parse(body);
        callback(parsed);
      });
    }).on('error', (e) => {
      console.log(`Erro na solicitação: ${e.message}`);
    }).end();
  }

  var findByPrefixo=function(prefixo,callback) {
    var agencias=[];
    var options={
      host: 'api-agencias.labbs.com.br',
      path: '/agencias?Numero='+prefixo,
      method: 'GET',
      headers: {apikey:BB_AGENCIAS_API_KEY}
    };
    requestAPI(options,callback);
  }

  var findByNome=function(nome,uf,callback) {
    var agencias=[];
    var options={
      host: 'api-agencias.labbs.com.br',
      path: '/agencias?Nome='+encodeURIComponent(nome)+(uf?'&UF='+uf:''),
      method: 'GET',
      headers: {apikey:BB_AGENCIAS_API_KEY}
    };
    requestAPI(options,callback);
  }

  var findByCidade=function(cidade,uf,callback) {
    var agencias=[];
    var options={
      host: 'api-agencias.labbs.com.br',
      path: '/agencias?Cidade='+encodeURIComponent(cidade)+(uf?'&UF='+uf:''),
      method: 'GET',
      headers: {apikey:BB_AGENCIAS_API_KEY}
    };
    requestAPI(options,callback);
  }

  var findByPosicao=function(latitude,longitude, raio_metros,callback) {
    var agencias=[];
    var options={
      host: 'api-agencias.labbs.com.br',
      path: '/agencias?Raio='+raio_metros + '&PosicaoRelativa='+latitude+'%2C'+longitude,
      method: 'GET',
      headers: {apikey:BB_AGENCIAS_API_KEY}
    };
    requestAPI(options,callback);
  }

  switch (classification) {
    case 'find_agencia_prefixo':
      var tokens=tokenizer.tokenize(messageText);
      var prefixo=tokens.find(function(item){
        return validator.isNumeric(item);
      });
      findByPrefixo(prefixo, callbackResponse);
      break;
    case 'find_agencia_nome':
      var regexp=new RegExp("(agencia de|dependencia de|agencia|dependencia)\\s([\\w\\s]*)","i");
      var match=regexp.exec(messageText);
      var nome=(match?match[2]:messageText);
      if (validator.isNumeric(nome)) {
        findByPrefixo(nome, callbackResponse);
      } else {
        findByNome(nome, ufToken, callbackResponse);
      }
      break;
    case 'find_agencia_cidade':
      var regexp=new RegExp("(cidade de|municipio de|cidade|municipio)\\s([\\w\\s]*)","i");
      var match=regexp.exec(messageText);
      var cidade=(match?match[2]:messageText);
      findByCidade(cidade, ufToken, callbackResponse);
      break;
    case 'find_agencia_posicao':
      findByPosicao(messageReceived.latitude, messageReceived.longitude, messageReceived.raio_metros, callbackResponse);
      break;
    case 'find_agencia_localizacao':
      sendShareLocation(recipientId);
      break;
    default:
      sendDefaultMessage(recipientId);
  }
  
}

function sendDefaultMessage(recipientId) {
  sendTextMessage(recipientId,"Não foi possível localizar a agência! Por favor tente ser mais específico como por exemplo: 'Agência Asa Norte 515','Prefixo 1606' ou 'Agência próxima'.");
}

function sendShareLocation(recipientId) {
  usersLocationConfirmation.push(recipientId);
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Por favor compartilhe sua localização:",
      quick_replies: [
        {
          "content_type":"location"
        },
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/rift.png"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/instagram_logo.gif"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: SERVER_URL + "/assets/sample.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPED_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      metadata: "DEVELOPER_DEFINED_METADATA",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error(response.statusCode+" - "+response.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
