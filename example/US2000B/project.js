'use strict';

var mpi = require("pylonconnect");

var mqtt = require('mqtt')
var client  = mqtt.connect('mqtt://localhost')

function MyMpiCallbacks () {
  var fr = 0;
  var fs = 0;
  var ft = 0;

  this.power_status = function (qc, data, arr, json, influx) {
    //console.log("mpi_power: influx : " + influx);
    //mpi.SendDataToInflux('mpi_power ' + influx);

    client.publish('solar/pylon', (Number(arr[0]) + Number(arr[1])).toString());
  }

  this.feeding_grid_power_calibration = function (qc, data, arr) {
    //console.log("feeding_grid_power_calibration: " + data);
    //console.log("feeding_grid_power_calibration: arr: " + arr);

    fr = arr[3];
    fs = arr[5];
    ft = arr[7];

    console.log("fr: " + fr + " fs: " + fs + " ft: " + ft);

    if (data) {
      mpi.SendDataToInflux('mpi_calibration fas_r=' + fr + ',fas_s=' + fs + ',fas_t=' + ft);
    }
  }

  this.before_f1 = function (values) {
    console.log("fr: " + fr + " fs: " + fs + " ft: " + ft);
  
    var watt = values.w;
    var fase = values.f;
  
    if (values.a == 1) {
      if (fase == 'R') { watt = Number(fr) + Number(watt);}
      if (fase == 'S') { watt = Number(fs) + Number(watt);}
      if (fase == 'T') { watt = Number(ft) + Number(watt);}
    }
  
    console.log('watt: ' + watt + ' fase:' + fase);
  
    return ({"fase" : fase + "ADJ1", "watt" : watt});
  }
  
  this.callback_f1 = function (qc, data, arr) {
    myMpi.SendQuickCommand("feeding_grid_power_calibration");
  }
}

var myMpi = new mpi.mpi();
var callbacks = new MyMpiCallbacks();
myMpi.init(callbacks);