// Copyright (c) 2017 ACCESS CO., LTD. All rights reserved.
//
// mockDataSrc.js
// * This is data source WebSocket Server
// * to be used as replacemnt of actual vehicle.
// * Function is just to send data to Vehicle Signal Server.

// preparation
// * Vehicle Signal Spec json file is required as 'vss.json'

//TODO:
// - enum値の取扱い
//

"use strict"

// == Set Server IP and Port Number here ==
var svr_config = require('./svr_config');
var DATASRC_PORT = svr_config.DATASRC_PORT;
var TIMER_INTERVAL = 1000;

//座席数の定義(vssには、Row5, Pos5などあり、無制限にありうるので)
//TODO: 必要以上の座席は使用しないようにしたい
var ROW_NUM = 1;
var POS_NUM = 2

//add data path you want to update in updateDataObj() 
var g_updateList = [
  "Signal.Drivetrain.Transmission.Speed",
  "Signal.Drivetrain.InternalCombustionEngine.RPM",
  "Signal.Chassis.SteeringWheel.Angle",
  "Signal.Chassis.Brake.PedalPosition",
  "Signal.Chassis.Accelerator.PedalPosition"
  // you can add data path here.
];

var fs = require('fs');

//TODO: json ファイル名を引数で与える
var g_vss;
try {
  g_vss = JSON.parse(fs.readFileSync('./vss.json', 'utf8'));
} catch(e) {
  console.log("Irregular format of VSS json. Exit.");
  return;
}
var g_dataObj = initDataObj(g_vss);

// ===========================
// == Start WebSocketServer ==
// ===========================
var WebSocketServer = require('websocket').server;
var http = require('http');

var httpSvr = http.createServer(function(request, response) {
  console.log((new Date()) + ' Received request for ' + request.url);
  response.writeHead(404);
  response.end();
});
httpSvr.listen(DATASRC_PORT, function() {
  console.log((new Date()) + ' httpSvr is listening on port '+DATASRC_PORT);
});

var dataSrcSvr = new WebSocketServer({
  httpServer: httpSvr,
  autoAcceptConnections: false
});

dataSrcSvr.on('request', function(request) {
  console.log('ws.on:request');

  var conn = request.accept();

  var timerId = setInterval(function() {
    updateDataObj(g_dataObj, g_updateList);
    var msg = generatePushJson(g_dataObj);
    //dbgDispLeafValue(g_dataObj, "Signal.Drivetrain.Transmission.Speed");
    //dbgDispLeafValue(g_dataObj, "Signal.Chassis.SteeringWheel.Angle");

    //send out via websocket
    conn.sendUTF(JSON.stringify(msg));
  }, TIMER_INTERVAL);

  // 原則としてdataSrcはデータを流すのみでclientからの入力は受け付けない
  // setのrequestのみ例外
  conn.on('message', function(msg) {
    if (msg.type === 'utf8') {
      //console.log('  :ws.on:message = '+ msg.utf8Data);
      var reqObj;
      try {
        reqObj = JSON.parse(msg.utf8Data);
      } catch(e) {
        console.log("Irregular format request. ignore.");
        return;
      }
      if (reqObj.action === 'set') {
        // request format: {'action':'set': 'data':
        //   {'requestId':'reqId str', 'path':'path str', 'value':'the value str'}}
        console.log('  :reqObj = '+ JSON.stringify(reqObj));
        var data = reqObj.data;
        var path = data.path;
        var val  = data.value;
        var reqId = data.requestId;
        var result = saveSetData(path, val);
        var retObj = createSetResponse(result, path, val,reqId);
        console.log('  :retObj = '+ JSON.stringify(retObj));
        conn.sendUTF(JSON.stringify(retObj));
      } else if (reqObj.action === 'getMetadata') {
        //TODO170728: no error case is considered here.
        // request format: {'action':'getMetadata': 'data'{'requestId':'reqId'}}
        console.log('  :reqObj = '+ JSON.stringify(reqObj));
        var data = reqObj.data;
        var reqId = data.requestId;
        var retObj = createVSSResponse(g_vss, reqId);
        console.log('  :retObj = '+ JSON.stringify(retObj).substr(0,300));
        conn.sendUTF(JSON.stringify(retObj));
      }
    }
  });

  conn.on('close', function() {
    // closing operation
    console.log('ws.on:close');
    clearInterval(timerId);
  });
});

/*
 - dataObj は手間を減らすため vssのJSON構造そのままを使用する
 - 必要な部分のみ値追加、変更する方針
 - 各leaf の初期値はどうする？ => 型だけ合わせた適当な値を使う
 - 各leaf の値の更新はどうする？=> リストアップされた値のみ更新する
*/
function initDataObj(_vss) {
  // just add 'value' in every leaf of vss
  var root = _vss;
  var dbg_depth = 0;

  // from root. itmes = Attirbute, Signal, Private
  Object.keys(root).forEach(function(key) {
    var node = root[key];
    //console.log("\nroot=>key = " + key);
    traverse(key, node, null, '', leafCallback, dbg_depth);
  });

  return root;

  function leafCallback(_key, _srcNode, _path) {
    addInitValue(_key, _srcNode, _path);
  }

  // 各データ毎に適した初期値を設定する
  // #正しい値を設定するには、項目毎の初期値が必要になるが
  //  そこまでせず、何かしら値があればよしとする
  function addInitValue(_key, _node, _path) {
    // get/set/subscribeのテスト用なら、何か値が入ればよいと考えるか。。
    // とすると、Stringでもデータに限らず'String1', 'String2' とかでもよい
    _node.path = _path;
    //console.log("addInitVal: path=" + _path);
    if (_node.type === 'Boolean') {
      _node.value = 'true';
    } else if (_node.type === 'String') {
      //TODO: what value should be given?
      _node.value = 'String1'; //dummy data
    } else if (_node.type === 'ByteBuffer') {
      //TODO: what value should be given?
      _node.value = 0;
    } else if (isNumberType(_node.type)) {
      //TODO: check min/max value
      _node.value = 0;
    } else {
      // wrong 'type' value
      // do nothing
    }
  }
}

// updateListにリストされているデータ項目のvalueを更新する
function updateDataObj(_dataObj, _updateList) {
  for (var i=0, len=_updateList.length; i < len; i++) {
    var path = _updateList[i];
    var leaf = getLeaf(_dataObj, path);
    if (leaf == undefined) {
      continue; //存在しないパスだった
    }

    var max = leaf.max, min = leaf.min;
    var preVal = leaf.value;
    var val = preVal;
    //TODO: 各データ毎に適切なupdateにしたい
    if (leaf.type==='Boolean') {
      if (preVal === true)
        val = false;
      else
        val = true;
      // true or false
    } else if (leaf.type==='String') {
      // for test: String1, 2, 3, 4, 5, 1, 2, 3, 4, ..
      if (preVal === 'String1')
        val = 'String2';
      else
        val = 'String1';
    } else if (leaf.type==='ByteBuffer') {
      // for test: 0, 10, 20, 30, 40,...,100
      val = preVal + 10;
      if (val > 100) val = 0;
    } else if (isNumberType(leaf.type)) {
      // for test: 0, 10, 20, 30, 40,...,100
      val = preVal + 10;
      if (min != undefined && max != undefined) {
        if (val > max) val = min;
      } else {
        if (val > 100) val = 0; // min/maxが無い場合は適当な値
      }
    } else {
      // wrong type
      // do nothing
    }
    leaf.value = val;
  }
}

// dataObjからVISS送付用のJSONを作成する
function generatePushJson(_dataObj) {
  var root = _dataObj;
  var resObj  = {};
  var date = new Date();
  var ts = date.getTime();
  var timestamp = new Date().getTime().toString(10);
  var dbg_depth = 0;

  Object.keys(root).forEach(
    function(key) {
      var targNode = resObj;
      var srcNode = root[key];
      traverse(key, srcNode, targNode, '', leafCallback, dbg_depth);
    }
  );
  return {"action":"data", "data":resObj};

  function leafCallback(_key, _srcNode, _targNode,  _path) {
    _targNode[_key]  = {'value':_srcNode.value, 'timestamp':timestamp};
  }
}

var ERR_INVALID_PATH = 'invalid_path';
var ERR_BAD_REQUEST = 'bad_request';
var ERR_OK = 'ok';

function saveSetData(_path, _value) {
  var leaf = getLeaf(g_dataObj, _path);
  if (leaf == undefined)
    return ERR_INVALID_PATH; //_path doesn't exist

  //_valueの型チェック
  if (isProperValueType(leaf.type, _value)==false)
    return ERR_BAD_REQUEST; //_value is not appropriate

  //値をセット
  var val = convertValueType(leaf.type, _value);
  leaf.value = val;
  return ERR_OK;
}

/*
 * [set response format]
 * success case: {'action':'set', 'data':{'requestId':reqId, 'timestamp':timestamp}}
 * error   case: {'action':'set', 'data':{'requestId':reqId, 'timestamp':timestamp, 'error': errObj}}
 * errObj: {'number':errorNumber, 'message':'error description'}
 */
function createSetResponse(result, path, value, dataSrcReqId) {
  var dataObj;
  var timestamp = new Date().getTime().toString(10);

  if (result == ERR_OK) {
    dataObj = {  //'path':path, 'value':value,
                 'requestId':dataSrcReqId,
                 'timestamp':timestamp};
  } else {
    var errObj = getErrorObj(result);
    dataObj = {  //'path':path,
                 'error':errObj,
                 'requestId':dataSrcReqId,
                 'timestamp':timestamp};
  }
  var obj = {'action':'set', 'data':dataObj};
  return obj;
}

/*
 * [getMetadata response format]
 * success case: {'action':'getMetadata', 'data':{'vss': vssObj, 'requestId':reqId}}
 * error   case: {'action':'getMetadata', 'data':{'error': errObj, 'requestId':reqId}}
 */
function createVSSResponse(_origVSSObj, dataSrcReqId) {
  var dataObj = {'vss':_origVSSObj,
                 'requestId':dataSrcReqId};
  var obj = {'action':'getMetadata', 'data': dataObj};
  return obj;
}

/*
 * errObj: {'number':errorNumber, 'message':'error description'}
 */
function getErrorObj(errValue) {
  /* decided not to use VISS spec's error definition as it is,
   * since it looks not matured.
   * Define own errors here which is simple and minimum.
   */
  var ret;
  if (errValue == ERR_BAD_REQUEST) {
    ret = {'number':400, 'message':'The server is unable to fulfil..'};
  } else if (errValue == ERR_INVALID_PATH) {
    ret = {'number':404, 'message':'The specified data path does not exist.'};
  } else {
    //unknown
    //this is not in the spec.
    ret = {'number':-1,  'message':'Error by unknown reason.'};
  }
  return ret;
}

// =====================
// === Utility funcs ===
// =====================

function dbg_strConcat(_str, num) {
  var res = "";
  for (var i=0; i<num; i++)
    res = res + _str;
  return res;
}

// VSS object の tree をなめる動作
function traverse(_key, _srcNode, _targNode, _path, _leafCallback, _depth) {
  //var spacer = dbg_strConcat("> ", _depth);
  //console.log("traverse: "+ spacer + _key+" type: "+_srcNode.type);

  var targNode = null;
  var depth = _depth+1;
  var path = _path=='' ? _key : _path+'.'+_key;

  if (_srcNode.type == undefined) {
    return;
  }
  if (_targNode != undefined && _targNode != null) {
    _targNode[_key] = {};
    targNode = _targNode[_key];
  }

  if (_srcNode.type === 'branch') {
    //branch case
    if (_srcNode.children) {
      // children以下の要素についてtraverseを行う
      Object.keys(_srcNode.children).forEach(function(key) {
        var srcNode = _srcNode.children[key];
        traverse(key, srcNode, targNode, path, _leafCallback, depth);
      });
    } else {
      //no children. do nothing.
    }
  } else {
    //leaf case
    if (_leafCallback != null && _leafCallback != undefined) {
      _leafCallback(_key, _srcNode, _targNode, path);
    }
  }
}

// debug用にpath指定したleafのvalueを表示する
function dbgDispLeafValue(_dataObj, _path) {
  var leaf = getLeaf(_dataObj, _path);
  if (leaf == undefined)
    console.log("dbgDispLeafValue: wrong path");
  else {
    console.log("dbgDispLeafValue: " + _path);
    console.log("    value= "+leaf.value);
  }
}

function getLeaf(_dataObj, _path) {
  var pathArry = _path.split(".");
  var obj = _dataObj;
  for (var i=0, len=pathArry.length; i<len; i++) {
    //console.log("path="+pathArry[i]);
    if (obj.children != undefined)
      obj = obj.children;
    if (obj[pathArry[i]] != undefined) {
      obj = obj[pathArry[i]];
    } else {
      //存在しないパス
      return undefined;
    }
  }
  return obj;
}

function isNumberType(_type) {
  if ( _type==='UInt8' || _type==='Int8'
    || _type==='UInt16' || _type==='Int16'
    || _type==='UInt32' || _type==='Int32'
    || _type==='UInt64' || _type==='Int64'
    || _type==='Float' || _type==='Double') {
    return true;
  } else {
    return false;
  }
}
function isIntegerType(_type) {
  if ( _type==='UInt8' || _type==='Int8'
    || _type==='UInt16' || _type==='Int16'
    || _type==='UInt32' || _type==='Int32'
    || _type==='UInt64' || _type==='Int64') {
    return true;
  } else {
    return false;
  }
}
function isDecimalType(_type) {
  if ( _type==='Float' || _type==='Double') {
    return true;
  } else {
    return false;
  }
}

function isString(obj) {
  return typeof(obj) == "string" || obj instanceof String;
}

function isNumber(obj) {
  // Booleanの場合は数値ではない、と判定
  var str = String(obj);
  if (str == 'true' || str == 'false' || str == '')
    return false;
  // それ以外の場合はisFinite()の判断の通りで
  return isFinite(obj);
}

// _valueの型が期待されているものかチェック
function isProperValueType( _type, _value) {
  if (_type === 'Boolean') {
    if (_value==='true' || _value==='false') {
      return true;
    } else {
      return false;
    }
  } else if (_type === 'String') {
    //TODO: 適切なチェックに書き換え
    // enumあるならenumと照合したい
    // _valueはそもそもStringなので、isString()は常にtrueになってしまうので
    if (isString(_value))
      return true;
    else
      return false;
  } else if (_type === 'ByteBuffer') {
    //TODO: 適切なチェックに書き換え
    return true;
  } else if (isNumberType(_type)) {
    //TODO: 適切なチェックに
    // Float/Doubleか、Int/UInt, 8/16/32/64 のチェック
    var num = parseInt(_value, 10);
    if (isNumber(num))
      return true;
    else
      return false;
  } else {
    //wrong 'type' value
  }
  return false;
}

// _valueの値をあるべき型に変換
//   _valueは文字列として受信するので
//   数値、Booleanなど型変換した値を返す
function convertValueType( _type, _value) {
  if (_type === 'Boolean') {
    if (_value == 'true')
      return true;
    else if(_value == 'false')
      return false;
  } else if (_type === 'String') {
    //_valueはもともとString
    return _value;
  } else if (_type === 'ByteBuffer') {
    //TODO: ここは変換は必要か？
    return _value;
  } else if (isDecimalType(_type)) {
      return parseFloat(_value);
  } else if (isIntegerType(_type)) {
      return parseInt(_value, 10);
  } else {
    //wrong 'type' value
  }
  return undefined;
}

