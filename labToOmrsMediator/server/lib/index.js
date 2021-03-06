#!/usr/bin/env node
'use strict'


const formidable = require('formidable');
const express = require('express')
const medUtils = require('openhim-mediator-utils')
const winston = require('winston')
const moment = require('moment');
var request = require('request');
var nconf = require('nconf');
nconf.file('../config/config.json');
var log = require('./log');

const utils = require('./utils')

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('../config/test') : require('../config/config')
const mediatorConfig = require('../config/mediator')

var port = process.env.NODE_ENV === 'test' ? 7001 : mediatorConfig.endpoints[0].port

var tests = {
    viral_load_2: {
        form: "Adult HIV Flowsheet - New Lab",
        visitType: "Primary Care Outpatient",
        encounterType: "HIV VISIT",
        parentConcept: "LABORATORY EXAMINATIONS CONSTRUCT",
        concept: "HIV VIRAL LOAD",
    },
    recency_vl: {
        q: "RECEN", //the key word to research the recencies concepts list
        form: "CBS Recency VL",
        visitType: "Primary Care Outpatient",
        encounterType: "CBS Recency VL",
        recencyAssayTestConcept: "RECENCY ASSAY TEST",
        recencyAssayResultConcept: "RECENCY ASSAY RESULTS",
        recencyViralLoadConcept: "RECENCY VIRAL LOAD",
        recencyViralLoadTestDateConcept: "RECENCY VIRAL LOAD TEST DATE",
        recencyViralLoadResultConcept: "RECENCY VIRAL LOAD RESULT",
        recencyViralLoadResultDateConcept: "RECENCY VIRAL LOAD RESULT DATE",

        yesConceptValue: "YES",
        recentConceptValue: "RECENT",
        longTermeConceptValue: "LONG-TERM",
        invalideConceptValue: "INVALID",
        negativeConceptValue: "NEGATIVE"
    },
    hiv_recency: {

    }
}

var locations = apiConf.locations;

function _getTheGoodResult(results, fieldCompare, value) {
    var result = undefined;
    if (results && results.length > 1) {
        var n;
        for (n = 0; n < results.length; n++) {
            if (results[n][fieldCompare] && results[n][fieldCompare] == value) {
                return results[n];
            }
        }
    } else if (results) {
        return results[0];
    }
    return undefined;
}

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp() {
    const app = express()
    var needle = require('needle');


    app.all('*', (req, res) => {
        winston.info(`Processing ${req.method} request on ${req.url}`)
        var responseBody = 'Primary Route Reached'
        var headers = {'content-type': 'application/json'}

        // add logic to alter the request here

        // capture orchestration data
        var orchestrationResponse = {statusCode: 200, headers: headers}
        let orchestrations = []
        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, responseBody))

        // set content type header so that OpenHIM knows how to handle the response
        res.set('Content-Type', 'application/json+openhim')


        // construct return object
        var properties = {property: 'Primary Route'}

        if (req.method == 'POST' && req.url == apiConf.api.urlPattern) {
            var form = new formidable.IncomingForm();
            form.parse(req, function (err, fields, files) {
                var data = fields;
                console.log('New data received', data);
                log.info('New data received', data);

                var nd_of_research = 0;
                var forbidenRepeatTime = 0;

                function LoopA(q) {
                    nd_of_research = nd_of_research + 1;
                    var openmrsIPAddress = locations["l_" + data.facilityCode];
                    if (q && q != "" && openmrsIPAddress) {
                        var options = {
                            url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/patient?q=" + q + "&v=full",
                            headers: {
                                'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                'Content-Type': 'application/json'
                            }
                        }

                        var testType = data.TestId.toLowerCase();

                        //// 1. Patient
                        log.info("Search for the patient " + q, locations["l_" + data.facilityCode]["hfname"]);
                        request.get(options, function (error, response, body) {
                            if (error) {
                                log.error("Error on patient research. Encounter creation aborted for " + data.SampleID + ".");
                                log.error(error);

                                orchestrationResponse = error
                                orchestrationResponse = {statusCode: 500, headers: headers}
                                orchestrations = []
                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                            } else {
                                log.info("Patient found");
                                if (response.statusCode == "200") {
                                    var results = JSON.parse(body).results;
                                    var patient = undefined;
                                    if (results && results.length == 1) {
                                        patient = results[0];

                                        options = {
                                            url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/visittype",
                                            headers: {
                                                'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                'Content-Type': 'application/json'
                                            }
                                        }

                                        //// 4. Get the VISIT TYPE 
                                        log.info("Search for the VISIT TYPE '" + tests.recency_vl.visitType + "'...");
                                        request.get(options, function (error, response, body) {
                                            if (error) {
                                                log.warn("VISIT TYPE " + tests.recency_vl.visitType + " not found!");
                                                log.error("Encounter creation aborted for " + data.SampleID + ".");
                                                log.error(error);



                                                orchestrationResponse = "Encounter creation aborted for " + data.SampleID + ".";
                                                orchestrationResponse = {statusCode: 500, headers: headers}
                                                orchestrations = []
                                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                            } else {
                                                var visittype = JSON.parse(body).results;
                                                if (visittype && visittype.length > 0) {
                                                    visittype = _getTheGoodResult(visittype, "display", tests.recency_vl.visitType)

                                                    //// 2. Location 
                                                    log.info("Search for the location '" + locations["l_" + data.facilityCode]["hfname"] + "'...");

                                                    location = locations["l_" + data.facilityCode];
                                                    switch (testType) {
                                                        case 'viral_load_2':
                                                            console.log("New HIV VIRAL LOAD 2 test from Labware. SampleID: '" + data.SampleID + "'", data);
                                                            options = {
                                                                url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/form?q=" + tests.viral_load_2.form + "&v=full",
                                                                headers: {
                                                                    'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                    'Content-Type': 'application/json'
                                                                }
                                                            }

                                                            //// 2. Form
                                                            log.info("Search for the form '" + tests.viral_load_2.form + "'...");
                                                            request.get(options, function (error, response, body) {
                                                                if (error) {
                                                                    log.error("Error on form search. Encounter creation aborted for " + data.SampleID + ".");
                                                                    log.error(error);

                                                                    orchestrationResponse = error
                                                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                                                    orchestrations = []
                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                } else {
                                                                    var form = JSON.parse(body).results;
                                                                    if (form && form.length > 0) {
                                                                        form = _getTheGoodResult(form, "display", tests.viral_load_2.form)
                                                                        options = {
                                                                            url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/concept?q=" + tests.viral_load_2.parentConcept + "&v=full",
                                                                            headers: {
                                                                                'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                'Content-Type': 'application/json'
                                                                            }
                                                                        }

                                                                        //// 3. Parent concept
                                                                        log.info("Search for encounter concept ");
                                                                        request.get(options, function (error, response, body) {
                                                                            if (error) {
                                                                                log.error("Error on encounter concept search. Encounter creation aborted for " + data.SampleID + ".");
                                                                                log.error(error);


                                                                                orchestrationResponse = error
                                                                                orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                orchestrations = []
                                                                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                            } else {
                                                                                var parentConcept = JSON.parse(body).results;
                                                                                if (parentConcept && parentConcept.length > 0) {
                                                                                    parentConcept = _getTheGoodResult(parentConcept, "display", tests.viral_load_2.parentConcept)

                                                                                    options = {
                                                                                        url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/concept?q=" + tests.viral_load_2.concept,
                                                                                        headers: {
                                                                                            'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                            'Content-Type': 'application/json'
                                                                                        }
                                                                                    };

                                                                                    //// 4. Concept
                                                                                    log.info("Search for obs concept ");
                                                                                    request.get(options, function (error, response, body) {
                                                                                        if (error) {
                                                                                            log.error("Error on obs concept search. Encounter creation aborted for " + data.SampleID + ".");
                                                                                            log.error(error);


                                                                                            orchestrationResponse = error
                                                                                            orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                            orchestrations = []
                                                                                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                        } else {
                                                                                            var concept = JSON.parse(body).results;
                                                                                            if (concept && concept.length > 0) {
                                                                                                concept = _getTheGoodResult(concept, "display", tests.viral_load_2.concept)

                                                                                                var encounterOptions = {
                                                                                                    url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/encounter",
                                                                                                    body: JSON.stringify(
                                                                                                            {
                                                                                                                "patient": patient.uuid,
                                                                                                                "form": form.uuid, //uuid of the concerned form in openmrs
                                                                                                                "encounterType": form.encounterType.uuid, //uuid of encounterType
                                                                                                                "location": location.uuid, //uuid of localtion
                                                                                                                "encounterDatetime": (new Date()).toISOString(),
                                                                                                                "obs": [
                                                                                                                    {
                                                                                                                        "concept": parentConcept.uuid, //uuid of perent concept
                                                                                                                        "person": patient.uuid, //uuid of patient
                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                        "groupMembers": [
                                                                                                                            {
                                                                                                                                "concept": concept.uuid, //uuid of concept
                                                                                                                                "person": patient.uuid, //uuid of patient
                                                                                                                                "location": location.uuid, //uuid of location
                                                                                                                                "obsDatetime": (new Date()).toISOString(),
                                                                                                                                "value": data.Result.copies, //hiv concentration value (copie/ml) comming from labware
                                                                                                                                "resourceVersion": "1.8"//OpenMRS version
                                                                                                                            }
                                                                                                                        ],
                                                                                                                        "location": location.uuid//uuid of location
                                                                                                                    }
                                                                                                                ],
                                                                                                                "visit": {
                                                                                                                    //"uuid": "db00fbc6-d100-44df-87f0-425f176152c4",
                                                                                                                    "patient": patient.uuid,
                                                                                                                    "visitType": visittype.uuid,
                                                                                                                    "location": location.uuid,
                                                                                                                    "startDatetime": (new Date(data.SampleDate)).toISOString()//DATE OF THE VISIT IMPORTANT TO CREATE NEW VISIT. We need to have the date of the visit
                                                                                                                },
                                                                                                                "encounterProviders": [{
                                                                                                                        "encounterRole": "a0b03050-c99b-11e0-9572-0800200c9a66",
                                                                                                                        "provider": "prov9b01-f749-4b3f-b8fe-8f6d460003bb",
                                                                                                                        "resourceVersion": "1.9"//OpenMRS version
                                                                                                                    }]
                                                                                                            }
                                                                                                    ),
                                                                                                    headers: {
                                                                                                        'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                                        'Content-Type': 'application/json'
                                                                                                    }
                                                                                                };

                                                                                                request.post(encounterOptions, function (error, response, body) {
                                                                                                    if (error) {
                                                                                                        log.error("Encounter creation aborted for " + data.SampleID + ".");
                                                                                                        log.error(error);
                                                                                                        log.error(response.body);

                                                                                                        orchestrationResponse = error
                                                                                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                        orchestrations = []
                                                                                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                                    } else {
                                                                                                        needle
                                                                                                                .post(apiConf.api.openMrsUrl, data, {})
                                                                                                                .on('readable', function () {

                                                                                                                })
                                                                                                                .on('done', function (err, resp) {
                                                                                                                    if (response.statusCode == "201" || response.statusCode == "200") {
                                                                                                                        log.info("Encounter created sucessfully for '" + locations["l_" + data.facilityCode]["hfname"] + "'.", "Sample ID: ", data.SampleID);
                                                                                                                    } else {
                                                                                                                        log.error("Encounter creation aborted for " + data.SampleID + ".", "Cause:");
                                                                                                                        log.error(response);
                                                                                                                    }


                                                                                                                    log.info('Transaction data posted OpenHIE', "to", apiConf.api.openMrsUrl);
                                                                                                                    orchestrationResponse = "Encounter created sucessfully for '" + locations["l_" + data.facilityCode]["hfname"] + "'.", "Sample ID: ", data.SampleID
                                                                                                                    orchestrationResponse = {statusCode: response.statusCode, headers: headers}
                                                                                                                    orchestrations = []
                                                                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, response.body))
                                                                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Success', 200, headers, "OK", orchestrations, properties))
                                                                                                                })
                                                                                                    }
                                                                                                });


                                                                                            }
                                                                                        }
                                                                                    });
                                                                                }
                                                                            }
                                                                        });
                                                                    }//TODO Manage the case no form found here
                                                                }
                                                            });


                                                            break;
                                                        case 'recency_vl':
                                                            log.info("New Recency VL test from Labware. SampleID: '" + data.SampleID + "'", data);
                                                            options = {
                                                                url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/form?q=" + tests.recency_vl.form + "&v=full",
                                                                headers: {
                                                                    'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                    'Content-Type': 'application/json'
                                                                }
                                                            }

                                                            //// 2. Form 
                                                            log.info("Search for the form '" + tests.recency_vl.form + "'...");
                                                            request.get(options, function (error, response, body) {
                                                                if (error) {
                                                                    log.warn("Form " + tests.recency_vl.form + " not found!");
                                                                    log.error("Error on search. Encounter creation aborted for " + data.SampleID + ".");
                                                                    log.error(error);

                                                                    orchestrationResponse = error
                                                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                                                    orchestrations = []
                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                } else {
                                                                    var form = JSON.parse(body).results;
                                                                    if (form && form.length > 0) {
                                                                        form = _getTheGoodResult(form, "display", tests.recency_vl.form);

                                                                        options = {
                                                                            url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/concept?q=" + tests.recency_vl.q + "&v=full",
                                                                            headers: {
                                                                                'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                'Content-Type': 'application/json'
                                                                            }
                                                                        }

                                                                        //// 3.0. Get the RECENCY concepts list
                                                                        log.info("Search for the RECENCY list ...");
                                                                        request.get(options, function (error, response, body) {
                                                                            if (error) {
                                                                                log.log(error);


                                                                                orchestrationResponse = error
                                                                                orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                orchestrations = []
                                                                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                            } else {
                                                                                var recencies = JSON.parse(body).results;
                                                                                if (recencies && recencies.length > 0) {
                                                                                    var recencyAssayResultConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyAssayResultConcept)
                                                                                    var recencyAssayTestConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyAssayTestConcept)
                                                                                    var recencyViralLoadResultConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyViralLoadResultConcept)
                                                                                    var recencyViralLoadResultDateConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyViralLoadResultDateConcept)
                                                                                    var recencyViralLoadTestDateConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyViralLoadTestDateConcept)
                                                                                    var recentConceptValue = _getTheGoodResult(recencies, "display", tests.recency_vl.recentConceptValue)
                                                                                    var recencyViralLoadConcept = _getTheGoodResult(recencies, "display", tests.recency_vl.recencyViralLoadConcept)

                                                                                    if (data.Result && data.Result.copies) {

                                                                                        var ritaConcept = "RECENT";
                                                                                        if (data.Result.copies == "NEGATIVE") {
                                                                                            ritaConcept = "INVALID";
                                                                                        } else {
                                                                                            var copiesml = parseInt(data.Result.copies, 10);
                                                                                            if (copiesml > 1000) {
                                                                                                ritaConcept = "RECENT";
                                                                                            } else {
                                                                                                ritaConcept = "LONG-TERM";
                                                                                            }
                                                                                        }

                                                                                        options = {
                                                                                            url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/concept?q=" + ritaConcept,
                                                                                            headers: {
                                                                                                'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                                'Content-Type': 'application/json'
                                                                                            }
                                                                                        }

                                                                                        //// 3.1. Get the RITA Concept
                                                                                        request.get(options, function (error, response, body) {
                                                                                            if (error) {
                                                                                                log.error(error);


                                                                                                orchestrationResponse = error
                                                                                                orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                orchestrations = []
                                                                                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                            } else {
                                                                                                var ritaResultConceptValue = JSON.parse(body).results;
                                                                                                if (ritaResultConceptValue && ritaResultConceptValue.length > 0) {
                                                                                                    var ritaResultConceptValue = _getTheGoodResult(ritaResultConceptValue, "display", ritaConcept)

                                                                                                    options = {
                                                                                                        url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/concept?q=" + tests.recency_vl.yesConceptValue,
                                                                                                        headers: {
                                                                                                            'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                                            'Content-Type': 'application/json'
                                                                                                        }
                                                                                                    }

                                                                                                    //// 3.2. Get the YES Concept
                                                                                                    request.get(options, function (error, response, body) {
                                                                                                        if (error) {
                                                                                                            log.error(error);


                                                                                                            orchestrationResponse = error
                                                                                                            orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                            orchestrations = []
                                                                                                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                                        } else {
                                                                                                            var yesConceptValue = JSON.parse(body).results;
                                                                                                            if (yesConceptValue && yesConceptValue.length > 0) {
                                                                                                                var yesConceptValue = _getTheGoodResult(yesConceptValue, "display", tests.recency_vl.yesConceptValue)


                                                                                                                var encounterOptions = {
                                                                                                                    url: openmrsIPAddress.ip + "/openmrs/ws/rest/v1/encounter",
                                                                                                                    body: JSON.stringify(
                                                                                                                            {
                                                                                                                                "encounterDatetime": (new Date(data.SampleDate)).toISOString(),
                                                                                                                                "patient": patient.uuid,
                                                                                                                                "location": location.uuid,
                                                                                                                                "form": form.uuid,
                                                                                                                                "encounterType": form.encounterType.uuid,
                                                                                                                                "obs": [
                                                                                                                                    {
                                                                                                                                        "concept": recencyAssayTestConcept.uuid,
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": {
                                                                                                                                            "uuid": yesConceptValue.uuid //ALWAYS YES concept
                                                                                                                                        },
                                                                                                                                        "resourceVersion": "1.8"
                                                                                                                                    },
                                                                                                                                    {
                                                                                                                                        "concept": recencyViralLoadConcept.uuid, //RECENCY VIRAL LOAD: YES
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": {
                                                                                                                                            "uuid": yesConceptValue.uuid //ALWAYS YES concept
                                                                                                                                        }
                                                                                                                                    },
                                                                                                                                    {
                                                                                                                                        "concept": recencyViralLoadResultConcept.uuid,
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": data.Result.copies,
                                                                                                                                        "resourceVersion": "1.8"
                                                                                                                                    },
                                                                                                                                    {
                                                                                                                                        "concept": recencyViralLoadResultDateConcept.uuid,
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": (new Date(data.DateReleased.trim())).toISOString(),
                                                                                                                                        "resourceVersion": "1.8"
                                                                                                                                    },
                                                                                                                                    {
                                                                                                                                        "concept": recencyViralLoadTestDateConcept.uuid,
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": (new Date(data.DateReleased.trim())).toISOString()
                                                                                                                                    }, {
                                                                                                                                        "concept": recencyAssayResultConcept.uuid, //RITA RESULT
                                                                                                                                        "person": patient.uuid,
                                                                                                                                        "obsDatetime": (new Date()).toISOString(),
                                                                                                                                        "location": location.uuid,
                                                                                                                                        "voided": false,
                                                                                                                                        "value": {
                                                                                                                                            "uuid": ritaResultConceptValue.uuid // RECENT, LONG-TERM or INVALID
                                                                                                                                        }
                                                                                                                                    }
                                                                                                                                ],
                                                                                                                                "visit": {
                                                                                                                                    //"uuid": "db00fbc6-d100-44df-87f0-425f176152c4",
                                                                                                                                    "patient": patient.uuid,
                                                                                                                                    "visitType": visittype.uuid,
                                                                                                                                    "location": location.uuid,
                                                                                                                                    "startDatetime": (new Date(data.SampleDate)).toISOString()//DATE OF THE VISIT IMPORTANT TO CREATE NEW VISIT. We need to have the date of the visit
                                                                                                                                },
                                                                                                                                "encounterProviders": [{
                                                                                                                                        "encounterRole": "a0b03050-c99b-11e0-9572-0800200c9a66",
                                                                                                                                        "provider": "42d9557b-9ec1-4999-8aa3-14087c961b51", //Labware
                                                                                                                                        "resourceVersion": "1.9"
                                                                                                                                    }],
                                                                                                                                "resourceVersion": "1.9"
                                                                                                                            }
                                                                                                                    ),
                                                                                                                    headers: {
                                                                                                                        'Authorization': 'Basic ' + Buffer.from("geoffrey:Ganyugxy1").toString('base64'),
                                                                                                                        'Content-Type': 'application/json'
                                                                                                                    }
                                                                                                                };

                                                                                                                //res.sendStatus(200);
                                                                                                                request.post(encounterOptions, function (error, response, body) {
                                                                                                                    if (error) {
                                                                                                                        log.warn("Encounter creation aborted for " + data.SampleID + ".");
                                                                                                                        log.error(error);
                                                                                                                        log.error(response.body);


                                                                                                                        orchestrationResponse = error
                                                                                                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                                        orchestrations = []
                                                                                                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                                                    } else {

                                                                                                                        //console.log('statusCode:', response && response.statusCode);
                                                                                                                        //console.log('body:', body);
                                                                                                                        //res.sendStatus(response.statusCode);
                                                                                                                        needle
                                                                                                                                .post(apiConf.api.openMrsUrl, data, {})
                                                                                                                                .on('readable', function () {

                                                                                                                                })
                                                                                                                                .on('done', function (err, resp) {
                                                                                                                                    if (response.statusCode == "201" || response.statusCode == "200") {
                                                                                                                                        log.info("Encounter created sucessfully for '" + locations["l_" + data.facilityCode]["hfname"] + "'.", "Sample ID: ", data.SampleID);
                                                                                                                                    } else {
                                                                                                                                        log.warn("Encounter creation aborted for " + data.SampleID + ".", "Cause:");
                                                                                                                                        log.error(response);
                                                                                                                                    }


                                                                                                                                    log.info('Transaction data posted OpenHIE', "to", apiConf.api.openMrsUrl);
                                                                                                                                    orchestrationResponse = "Encounter created sucessfully for '" + locations["l_" + data.facilityCode]["hfname"] + "'.", "Sample ID: ", data.SampleID
                                                                                                                                    orchestrationResponse = {statusCode: response.statusCode, headers: headers}
                                                                                                                                    orchestrations = []
                                                                                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, response.body))
                                                                                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Success', 200, headers, "OK", orchestrations, properties))
                                                                                                                                })


                                                                                                                    }
                                                                                                                });





                                                                                                            } else {
                                                                                                                log.warn("Concept not found!", locations["l_" + data.facilityCode]["hfname"]);
                                                                                                                log.error("Encounter creation aborted for " + data.SampleID + ".");

                                                                                                                orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                                                                                orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                                orchestrations = []
                                                                                                                orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                                res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                                            }
                                                                                                        }
                                                                                                    });
                                                                                                } else {
                                                                                                    log.warn("Concept not found!", locations["l_" + data.facilityCode]["hfname"]);
                                                                                                    log.error("Encounter creation aborted for " + data.SampleID + ".");


                                                                                                    orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                                                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                                    orchestrations = []
                                                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                                }
                                                                                            }
                                                                                        });
                                                                                    } else {
                                                                                        log.warn("Data with empty result received!");
                                                                                        log.error("Encounter creation aborted for " + data.SampleID + ".");

                                                                                        orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                        orchestrations = []
                                                                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                    }
                                                                                } else {
                                                                                    log.warn("RECENCY concept list not found!", locations["l_" + data.facilityCode]["hfname"]);
                                                                                    log.error("Encounter creation aborted for " + data.SampleID + ".");


                                                                                    orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                                                                    orchestrations = []
                                                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                                }
                                                                            }
                                                                        });
                                                                    } else {
                                                                        log.warn("Form " + tests.recency_vl.form + " not found!", locations["l_" + data.facilityCode]["hfname"]);
                                                                        log.error("Encounter creation aborted for " + data.SampleID + ".");

                                                                        orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                                                        orchestrations = []
                                                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                                    }
                                                                }
                                                            });

                                                            break;
                                                        case 'hiv_recency':
                                                            //TODO
                                                            log.info("New HIV recency result from Labware. SampleID: '" + data.SampleID + "'", data);
                                                            orchestrationResponse = "Operation succeeded"
                                                            orchestrationResponse = {statusCode: 200, headers: headers}
                                                            orchestrations = [];
                                                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Success', 200, headers, "OK", orchestrations, properties))
                                                            break;
                                                    }//END Switch

                                                } else {
                                                    log.warn("Visite type not found!", locations["l_" + data.facilityCode]["hfname"]);
                                                    log.error("Encounter creation aborted for " + data.SampleID + ".");


                                                    orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                                    orchestrations = []
                                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                                }
                                            }
                                        });
                                    } else if (results && results.length == 0) {//No result found
                                        if (nd_of_research < 2) {//Second research possible by name 
                                            log.warn("No patient found, searching by name: " + data.firstName + " " + data.lastName);
                                            LoopA(data.firstName + " " + data.lastName);
                                        } else {
                                            log.warn("No patient found in " + locations["l_" + data.facilityCode]["hfname"], "Name: " + data.firstName + " " + data.lastName);
                                            log.error("Encounter creation aborted for " + data.SampleID + ".");


                                            orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                            orchestrationResponse = {statusCode: 500, headers: headers}
                                            orchestrations = []
                                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                        }
                                    } else {
                                        log.warn("Oups, it looks like we have we found many patients corresponding with the input data, we are not able to take decision.");
                                        log.error("Encounter creation aborted for " + data.SampleID + ".");


                                        orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                        orchestrations = []
                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                    }
                                } else if (response.statusCode == "403") {
                                    log.error("FORBIDEN statusCode: ", response.statusCode);
                                    if (forbidenRepeatTime < 1) {
                                        LoopA(data.tractnetID);//Search by TracknetID Firts
                                    } else {
                                        log.error("ACCESS FORBIDEN");
                                        log.error("Encounter creation aborted for " + data.SampleID + ".");


                                        orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                        orchestrationResponse = {statusCode: 500, headers: headers}
                                        orchestrations = []
                                        orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                    }
                                } else {
                                    log.error("Encounter creation aborted for unkown reason.", "Status Code " + response.statusCode);


                                    orchestrationResponse = "Encounter creation aborted for " + data.SampleID + "."
                                    orchestrationResponse = {statusCode: 500, headers: headers}
                                    orchestrations = []
                                    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, body))
                                    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, body, orchestrations, properties))
                                }
                            }
                        });
                    } else {
                        if (nd_of_research < 2) {//Second research possible by name 
                            log.warn("No patient found, searching by name : " + data.firstName + " " + data.lastName);
                            LoopA(data.firstName + " " + data.lastName);
                        } else if (!openmrsIPAddress) {
                            log.warn("Unknown health facility ", data.facilityCode, "Operation aborted");
                            orchestrationResponse = "Operation aborted. Unknown health facility " + data.facilityCode;
                            orchestrationResponse = {statusCode: 500, headers: headers};
                            orchestrations = [];
                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, "Failed"))
                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Not Implemented', 501, headers, "Not Implemented", orchestrations, properties))
                        } else {
                            log.warn("No patient found. Operation aborted");
                            orchestrationResponse = ""
                            orchestrationResponse = {statusCode: 500, headers: headers}
                            orchestrations = [];
                            orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, "Failed"))
                            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 500, headers, "Failed", orchestrations, properties))
                        }
                    }
                }
                log.info("Searching patient by tracnetID: " + data.tracnetID);
                LoopA(data.tracnetID);//Search by TracknetID Firts
            });

        }
    })
    return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start(callback) {
    if (apiConf.api.trustSelfSigned) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    }

    if (apiConf.register) {
        //if (false) {
        medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
            if (err) {
                winston.error('Failed to register this mediator, check your config')
                console.log('Failed to register this mediator, check your config');
                winston.error(err.stack)
                process.exit(1)
            }
            apiConf.api.urn = mediatorConfig.urn
            medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
                winston.info('Received initial config:')
                winston.info(JSON.stringify(newConfig))
                config = newConfig
                if (err) {
                    winston.error('Failed to fetch initial config')
                    console.log('Failed to fetch initial config');
                    winston.error(err.stack)
                    process.exit(1)
                } else {
                    winston.info('Successfully registered mediator!')
                    console.log('Successfully registered mediator!');
                    let app = setupApp()
                    const server = app.listen(port, () => {
                        if (apiConf.heartbeat) {
                            let configEmitter = medUtils.activateHeartbeat(apiConf.api)
                            configEmitter.on('config', (newConfig) => {
                                winston.info('Received updated config:')
                                winston.info(JSON.stringify(newConfig))
                                // set new config for mediator
                                config = newConfig

                                // we can act on the new config received from the OpenHIM here
                                winston.info(config)
                            })
                        }
                        callback(server)
                    })
                }
            })
        })
    } else {
        // default to config from mediator registration
        config = mediatorConfig.config
        let app = setupApp()
        const server = app.listen(port, () => callback(server))
        log.info('Labware OpenMRS mediator started on port ' + port);
    }
}
exports.start = start

if (!module.parent) {
    // if this script is run directly, start the server
    start(() => winston.info(`Listening on ${port}...`))
}
