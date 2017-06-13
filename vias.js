// ========================================
// VIAS proto
// ========================================

// シンプルなコンストラクタとして作る
// ES6 class で作成の予定だったが、その場合
// private property/method の実現方式のbest practiceが
// 不明確のため、ES5の旧式のclass作成方式を使用した
// private な property は特に作らない。当面は。
// TODO: と思ったが、一般に使ってもらう lib とするには、
// 余計なものを隠蔽することが必要

// ==============================

// == Request Dictionary Class ==
// ##define class in conventional method
var ReqDict = (function() {

  // == private prop ==
  var mainDict = {};
  var cliSubIdDict = {};
  var svrSubIdDict = {};

  // == constructor ==
  var reqDict = function() {
  };

  var p = reqDict.prototype;

  // == public method ==
  p.addRequest = function(_reqId, _obj) {

    dbgLog("addRequest: reqId="+ _reqId);
    if (mainDict[_reqId] != undefined) {
      this.dgbLog("--:Error: requestId already used. reqId="+ _reqId);
      return false;
    }
    mainDict[_reqId] = _obj;
    dbgLog("--:EntryNum=" + Object.keys(mainDict).length);
    return true;
  };
  p.deleteRequest = function(_reqId) {

    dbgLog("deleteRequest: reqId="+_reqId);
    if (mainDict[_reqId] == undefined)
      return false;
    // delete entry from mainDict
    var svrSubId = mainDict[_reqId].svrSubId;
    var cliSubId = mainDict[_reqId].cliSubId;
    delete mainDict[_reqId];

    // TODO: unsubscribeのエントリは*SubIdDictには登録しない
    // delete entry from *SubIdDict
    if (svrSubId != undefined && svrSubIdDict[svrSubId] != undefined)
      delete svrSubIdDict[svrSubId];
    if (cliSubId != undefined && cliSubIdDict[cliSubId] != undefined)
      delete cliSubIdDict[cliSubId];

    dbgLog("--:entry deleted. reqId="+_reqId+" ,cliSubId="+cliSubId+" ,svrSubId="+svrSubId);
    return true;
  };
  p.getRequestByReqId = function(_reqId) {
    if (mainDict[_reqId] == undefined) return false;
    return mainDict[_reqId];
  };
  p.getRequestBySvrSubId = function(_svrSubId) {
    var reqId = svrSubIdDict[_svrSubId];
    if (reqId == undefined) return false;
    return this.getRequestByReqId(reqId);
  };
  p.addCliSubId = function(_reqId, _cliSubId) {
    dbgLog("addCliSubId: reqId="+_reqId+" cliSubId="+_cliSubId);
    // this func is only for 'subscribe' request.
    // should not be used for 'unsubscribe' request, otherwise
    // a subscriptionId may be used twice in hash array.
    if (mainDict[_reqId] == undefined) {
      dbgLog("--:Error: this requestId entry not exits. reqId="+_reqId);
      return false;
    }
    if (cliSubIdDict[_cliSubId] != undefined) {
      dbgLog("--:Error: this subscriptionId already used. subId="+_svrSubId);
      return false;
    }
    cliSubIdDict[_cliSubId] = _reqId; // for cross reference.
    return true;
  };
  p.addSvrSubId = function(_reqId, _svrSubId) {

    dbgLog("addSvrSubId: reqId="+_reqId+" svrSubId="+_svrSubId);
    // this func is only for 'subscribe' request.
    // should not be used for 'unsubscribe' request, otherwise
    // a subscriptionId may be used twice in hash array.
    if (mainDict[_reqId] == undefined) {
      dbgLog("--:Error: this requestId entry not exits. reqId="+_reqId);
      return false;
    }
    if (svrSubIdDict[_svrSubId] != undefined) {
      dbgLog("--:Error: this subscriptionId already used. subId="+_svrSubId);
      return false;
    }
    mainDict[_reqId].svrSubId = _svrSubId;
    svrSubIdDict[_svrSubId] = _reqId; // for cross reference.
    return true;

  };
  p.convertSvrSubIdToReqId = function(_subId) {
    //TODO
  };
  p.convertReqIdToSvrSubId = function(_reqId) {
    //TODO

  };
  p.convertCliSubIdToSvrSubId = function(_cliSubId) {
    var reqId = cliSubIdDict[_cliSubId];
    var reqObj = mainDict[reqId];
    var svrSubId = reqObj.svrSubId;
    return svrSubId;
  };

  // == private method
  function dbgLog(_msg) {
    //console.log("[VIAS:ReqDict]:"+_msg);
  }

  return reqDict;
})();


// =======================
// == VISClient Class   ==
// == (= Core of VIAS ) ==
// =======================
//class VISClient {
var VISClient = (function() {

  // ==================
  // == private prop ==
  var WS_CONNECTING = 0;
  var WS_OPEN       = 1;
  var WS_CLOSING    = 2;
  var WS_CLOSED     = 3;
  var SUBPROTOCOL = "wvss1.0";

  // important object
  var g_reqDict = new ReqDict();
  var connection = null;

  var visClient = function(_viscOption) {

    // =================
    // == public prop ==
    // プロパティ初期化
    if (_viscOption) {
      this.host = _viscOption.host;
      this.protocol = _viscOption.protocol;
      this.port = _viscOption.port;
    }
  }

  // ===================
  // == public method ==
  var p = visClient.prototype;

  p.connect = function(_sucCb, _errCb) {
    // TODO: connect の失敗ケースはどんな場合？

    // WebSocket接続を確立
    var url = this.protocol + this.host + ':' + this.port;
    connection = new WebSocket(url, SUBPROTOCOL);
    // 成功したら _sucCbで通知(何を？
    connection.onopen    = () =>       {onWsOpen   (this, _sucCb);};
    connection.onclose   = () =>       {onWsClose  (this);};
    connection.onmessage = (_event) => {onWsMessage(this, _event);}
    connection.onerror   = () =>       {onWsError  (this, _errCb)};

  };
  p.get = function(_path, _sucCb, _errCb) {
    dbgLog("get: path=" + _path);
    if (connection == null || connection.readyState != WS_OPEN) {
      // TODO: エラーを返す
      return;
    }

    // get用JSONを作成
    var reqId = issueNewReqId();
    var req = {"action": "get", "path": _path, "requestId":reqId};

    // sucCb, errCb, reqIdはハッシュに登録しておく
    var obj = {"reqObj": req, "sucCb": _sucCb, "errCb": _errCb};
    g_reqDict.addRequest(reqId, obj);

    // ws で送付
    var json_str = JSON.stringify(req);
    connection.send(json_str);

    dbgLog("--: ==> " + json_str);
  };
  p.subscribe = function(_path, _sucCb, _errCb, _filter) {
    dbgLog("subscribe: path=" + _path);
    if (connection == null || connection.readyState != WS_OPEN) {
      // TODO: エラーを返す
      return;
    }

    // subscribe用JSONを作成
    var reqId = issueNewReqId();
    // 同期的にsubIdを返すため、subIdを2重構造にしてみた
    // 同期で返せる clientSide subId
    // 非同期でVISSから送付される serverSide subId
    // 関連付けて使用すれば困らない想定
    var cliSubId = issueNewCliSubId();

    //TODO: filter not supported
    var req ={"action": "subscribe", "path": _path, "filters":"", "requestId":reqId};

    var obj = {"reqObj": req, "sucCb": _sucCb, "errCb":_errCb,
               "cliSubId": cliSubId, "svrSubId":null };
    g_reqDict.addRequest(reqId, obj);
    g_reqDict.addCliSubId(reqId, cliSubId);

    var json_str = JSON.stringify(req);
    connection.send(json_str);
    dbgLog("--: ==> " + json_str);

    // 同期的に仮のsubIdを返す
    return cliSubId;

    // このあとの流れ：
    // VISSから、subscribeSuccessResponse jsonとして、serverSide subIdが届く
    //   => clientSide subId と関連づけられるように、reqDictに格納
    // VISSから、subscriptionNotification として、pathの値が届く
    //   => serverSide subId付きで届くので、clientSide subIdに変換して
    //      呼び出し元の success Callback で通知

  };
  p.unsubscribe = function(_cliSubId, _sucCb, _errCb) {

    dbgLog("unsubscribe: cliSubId=" + _cliSubId);
    if (connection == null || connection.readyState != WS_OPEN) {
      // TODO: エラーを返す
      return;
    }

    var reqId = issueNewReqId(); //reqIdはunsub用に新しいものを使用
    var svrSubId = g_reqDict.convertCliSubIdToSvrSubId(_cliSubId);
    dbgLog("unsubscribe: svrSubId=" + svrSubId);

    // VISS に送付する、unsubscribeRequest json を作る
    var req = {"action": "unsubscribe", "requestId":reqId, "subscriptionId":svrSubId};
    var obj = {"reqObj": req, "sucCb": _sucCb, "errCb":_errCb,
               "cliSubId": _cliSubId, "svrSubId": svrSubId };
    // unsubscribe は、逆引き用の *SubIdDict に登録しない
    // というのは、svrSubIdはすでに登録済みなので、ダブってしまうと逆引きできなくなるので

    // reqDictに登録する
    g_reqDict.addRequest(reqId, obj);
    var json_str = JSON.stringify(req);
    connection.send(json_str);

    dbgLog("--: ==> " + json_str);

  };

  // ====================
  // == private method ==

  // ===================
  // == Event handler ==
  // WebSocket用ハンドラ
  function onWsOpen(_thiz, _sucCb) {
    dbgLog("onOpen");
    _sucCb('websocket connected');
  }
  function onWsClose(_thiz) {
    dbgLog("onClose");
  }
  function onWsMessage(_thiz, _event) {
    dbgLog("onMessage");
    handleWsMessage(_event);
  }
  function onWsError(_thiz, _errCb) {
    //TODO: how to get error detail?
    dbgLog("onError");
    _errCb('error occurred.');
  }

  // ========================
  // == WS message handler ==

  // Main process to handle message from WebSocket
  //TODO: remove this?
  function handleWsMessage(_event) {
    dbgLog("handleWsMessage: event.data="+_event.data);
    var msg;
    try {
      msg = JSON.parse(_event.data);
    } catch(e) {
      dbgLog("Irregular Json received. Ignore.");
      return;
    }

    var reqDictItem=null, reqObj=null;
    var sucCb=null, errCb=null;
    var action=null, reqId=null, svrSubId=null, cliSubId=null;
    if (msg.requestId != undefined) {
      reqId = msg.requestId;
      reqDictItem = g_reqDict.getRequestByReqId(reqId);
    } else if (msg.subscriptionId != undefined) {
      //reqIdなし、subIdあり＝subscribe notification の場合
      svrSubId = msg.subscriptionId;
      reqDictItem = g_reqDict.getRequestBySvrSubId(svrSubId);
    }
    reqObj = reqDictItem.reqObj;
    sucCb = reqDictItem.sucCb;
    errCb = reqDictItem.errCb;

    if (reqObj)
      action = reqObj.action;

    // case of 'get'
    if (action === "get") {
      if (isGetSuccessResponse(msg)) {
        dbgLog("Get: response success");
        // get のsuccess では value のみ返す
        sucCb(msg.value);

      } else if (this.isGetErrorResponse(msg)) {
        dbgLog("Get: response fail");
        errCb(msg.error);
      }
      // delete request from requestHash. delete even in error case
      g_reqDict.deleteRequest(reqId);

    // case of 'set'
    } else if (action === "set") {
    } else if (action === "subscribe") {
      // subId 通知の場合
      if (isSubscribeSuccessResponse(msg)) {
        // VISS発行のsubId を Dictに格納する
        g_reqDict.addSvrSubId(msg.requestId, msg.subscriptionId);

      } else if (isSubscribeErrorResponse(msg)) {
        dbgLog("--: <== 'subscribe' request was rejected");
        errCb(msg.error.number);
        g_reqDict.deleteRequest(msg.requestId);

      // value 通知の場合
      } else if (isSubscriptionNotification(msg)) {
        // case of subscribeNotification

        // callbackで通知
        dbgLog("Subscribe: notification success: val= " + msg.value);
        sucCb(msg.value);

      } else if (isSubscriptionNotificationError(msg)) {
        // noting to do special here. continue subscribe.
        // callbackで通知
        dbgLog("Subscribe: notification fail" + msg.error.number);
        errCb(msg.error);

      }

    // TODO: subscriptionNotification は action=='subscription' になったらしい
    } else if (action === "subscription") {
      //       VISS は未対応なので、まだ使わない。

    } else if (action === "unsubscribe") {
      dbgLog("WsMsg:unSubscribe: received");

      // TODO:
      // unsubscribe responseをVISSから受け取った場合

      // 失敗ケース
      //  unsub request を reqDict から削除　
      if (msg.error != undefined) {
        dbgLog("WsMsg:unSubscribe: fail: err="+ msg.error.number);
        // unsubscribe failed
        // - delete unsubscribe request from requestTable
        g_reqDict.deleteRequest(reqId);
        errCb(msg.error);

      // 成功ケース
      //  sub request を reqDictから削除
      //  unsub request を reqDict から削除　
      } else {
        dbgLog("WsMsg:unSubscribe: success: svrSubId="+ msg.subscriptionId);
        // unsubscribe success
        // - delete subscribe request from requestTable
        // - delete unsubscribe request from requestTable
        var targ_svrSubId = msg.subscriptionId; //unsub対象のsubscribeのsubId
        var targ_reqId = g_reqDict.convertSvrSubIdToReqId(targ_svrSubId); //subscribeのreqId
        g_reqDict.deleteRequest(targ_reqId); // delete subscribe's entry in reqTable
        g_reqDict.deleteRequest(reqId);      // delete unsub's entry in reqTable
        sucCb();
      }
    }
  }

  // ======================
  // == helper functions ==
  // == get helper
  function isGetSuccessResponse(msg) {
    // This is getSuccessResponse if ...
    // must exist    : action, requestId, value, timestamp
    // must not exist: error
    if (msg.action === "get" && msg.requestId != undefined && 
        msg.value  != undefined && msg.timestamp != undefined &&
        msg.error == undefined)
      return true;
    else
      return false;
  }
  function isGetErrorResponse(msg) {
    // This is getErrorResponse if ...
    // must exist    : action, requestId, error, timestamp
    // must not exist: value
    if (msg.action === 'get' && msg.requestId != undefined && 
        msg.error != undefined && msg.timestamp != undefined && 
        msg.value == undefined)
      return true;
    else
      return false;
  }

  // == subscribe helper
  // TODO: better to verify with json shema?
  function isSubscribeSuccessResponse(msg) {
    // This is subscribeSuccessResponse if ...
    // must exist    : (action), requestId, subscriptionId, (timestamp)
    // must not exist: error, value
    if (msg.action === "subscribe" && msg.requestId != undefined && msg.subscriptionId != undefined &&
        msg.error == undefined && msg.value == undefined)
      return true;
    else
      return false;
  }
  function isSubscribeErrorResponse(msg) {
    // This is subscribeErrorResponse if ...
    // must exist    : (path), requestId, error,(timestamp)
    // must not exist: (action), subscriptionId, value
    if (msg.path != undefined && msg.requestId != undefined && msg.error != undefined && 
        msg.action == undefined && msg.subscriptionId == undefined && msg.value == undefined)
      return true;
    else
      return false;

  }
  function isSubscriptionNotification(msg) {
    // This is subscriptionNotification if ..
    // must exist    : subscriptionId, (path), value, (timestamp)
    // must not exist: error, (requestId), (action)
    if (msg.subscriptionId != undefined && msg.value != undefined &&
        msg.error == undefined)
      return true;
    else
      return false;
  }
  function isSubscriptionNotificationError(msg) {
    // This is subscriptionNotificationError if ..
    // following members exist    : subscriptionId, (path), error, (filters), (timestamp)
    // following members not exist: value, (requestId), (action)
    if (msg.subscriptionId != undefined && msg.error != undefined &&
        msg.value == undefined)
      return true;
    else
      return false;
  }

  // ======================
  // == Utility function ==
  //TODO よりちゃんとしたuniqueIDにしたい
  function issueNewReqId() {
    // create semi-uniquID (for implementation easyness) as timestamp(milli sec)+random string
    // uniqueness is not 100% guaranteed.
    var strength = 1000;
    var uniq = new Date().getTime().toString(16) + Math.floor(strength*Math.random()).toString(16);
    return "reqid-"+uniq;
  }
  function issueNewCliSubId() {
    // create semi-uniquID (for implementation easyness) as timestamp(milli sec)+random string
    // uniqueness is not 100% guaranteed.
    var strength = 1000;
    var uniq = new Date().getTime().toString(16) + Math.floor(strength*Math.random()).toString(16);
    return "clisubid-"+uniq;
  }
  function dbgLog(_msg) {
    //console.log("[VIAS]:"+_msg);
  }

  return visClient;

})();
