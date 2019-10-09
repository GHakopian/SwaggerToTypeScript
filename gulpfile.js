var fs = require('fs');
const { task } = require('gulp');
var gulp = require('gulp'),
    jeditor = require('gulp-json-editor'),
    request = require('request'),
    source = require('vinyl-source-stream'),
    streamify = require('gulp-streamify');

// options
const DataJsonFileName = "apiData.json";
const DataJsonSavePath = "./";
const swaggerJsonPath = "path/to/swagger/json";
const outputPath = "./generatedCode.ts";
const axiosInstanceName = "myApiAxiosIntance";
const createServices = true;

task('GenerateTypeScript', function (done) {
    request({
        method: "GET",
        "rejectUnauthorized": false,
        "headers": { "Content-Type": "application/json" },
        url: swaggerJsonPath
    })
        .pipe(source(DataJsonFileName))
        .pipe(gulp.dest(DataJsonSavePath)).on('end', function () {
            var data = JSON.parse(fs.readFileSync(DataJsonSavePath + DataJsonFileName));
            var code = "";
            if(createServices){
                // importing axios
                code += "import axios, { AxiosInstance, AxiosRequestConfig } from \"axios\";\r\n\r\n";
                // creating axios instance for api
                code += "export const "+axiosInstanceName+": AxiosInstance = axios.create();\r\n";
            }
            
            // creating interfaces for each definition
            code += generateInterfaces(data.definitions);
            
            if(createServices){
                // generate axios services
                code += generateServices(data.paths);
            }

            fs.writeFileSync(outputPath, code);
        });
    
    done();
});

function generateInterfaces(definitions) {
    var generatedCode = "";
    var usedClassNames = [];

    for (var className in definitions) {
        var normalizedClassName = className.replace("[", "<").replace("]", ">");
        var classNameOnly = normalizedClassName.substr(0, normalizedClassName.indexOf("<") - 1);

        // ignore duplications
        if (usedClassNames.find(function (x) { return x === classNameOnly })) {
            continue;
        } else {
            usedClassNames.push(classNameOnly);
        }

        var genericTypes = [];

        if (normalizedClassName.indexOf("<") > -1) {
            genericTypes = normalizedClassName.substr(normalizedClassName.indexOf("<") + 1, normalizedClassName.indexOf(">") - normalizedClassName.indexOf("<") - 1).split(",");
        }

        var genericTypesMap = [];
        for (var i = 0; i < genericTypes.length; i++) {
            var typeName = genericTypes[i];
            var genericName = "T" + (i + 1);
            genericTypesMap.push({
                tName: typeName,
                tGeneric: genericName
            });
            normalizedClassName = normalizedClassName.replace(typeName, genericName);
        }
        generatedCode += "export interface " + normalizedClassName + " {\r\n";
        for (var key in definitions[className].properties) {

            var propertyType = definitions[className].properties[key].type;

            if (!propertyType) {
                propertyType = definitions[className].properties[key].$ref;
                propertyType = propertyType.substring(propertyType.lastIndexOf("/") + 1);
            }
            if (propertyType === "array") {
                propertyType = definitions[className].properties[key].items.$ref;
                if (propertyType) {
                    propertyType = propertyType.substring(propertyType.lastIndexOf("/") + 1);
                } else {
                    propertyType = definitions[className].properties[key].items.type;
                }
                if (propertyType) {
                    propertyType += "[]";
                } else {
                    propertyType = "object[]";
                }
            }
            if (propertyType === "integer") { propertyType = "number"; }
            if (propertyType === "IFormFile") { propertyType = "File"; }
            for (var t = 0; t < genericTypesMap.length; t++) {
                var typeMap = genericTypesMap[t];
                propertyType = propertyType.replace(typeMap.tName, typeMap.tGeneric);
            }
            generatedCode += "\t" + key + ": " + propertyType + ";\r\n";
        }
        generatedCode += "}\r\n";
    }

    return generatedCode;
}

function getServiceObjects(paths) {
    var services = [];

    for (var servicePath in paths) {
        var serviceName = servicePath.substring(1); // skipping api
        var endIndex = serviceName.indexOf("/") > 0 ? serviceName.indexOf("/") : serviceName.length;
        serviceName = serviceName.substring(0, endIndex) + "Service";
        var service = services.find(function (s) {
            return s.name === serviceName;
        });
        var curlyIndex = servicePath.indexOf("/{");
        var actionName = servicePath;
        if (curlyIndex > 0) {
            actionName = servicePath.substring(0, curlyIndex);
        }
        var isNew = false;

        if (!service) {
            service = {
                name: serviceName,
                actions: []
            };
            isNew = true;
        }

        for (var type in paths[servicePath]) {
            var operation = paths[servicePath][type];
            service.actions.push({
                type: type,
                url: servicePath,
                contentType: operation.consumes[0],
                actionName: operation.operationId,
                parameters: operation.parameters,
                response: operation.responses["200"]
            });
        }
                
        if (isNew) {
            services.push(service);
        }
    }
    
    return services;
}

function generateServices(paths){
    // creating service objects to make it easyer to work with
    var services = getServiceObjects(paths);
    generatedCode = "";
    for (var i = 0; i < services.length; i++) {
        var serviceObject = services[i];
                
        generatedCode += "export class " + serviceObject.name + " {\r\n";
        generatedCode += "\tconstructor() {\r\n";
        generatedCode += "\t}\r\n";

        for (var j = 0; j < serviceObject.actions.length; j++) {
            var actionObject = serviceObject.actions[j];
                    
            var parameters = "";
            var url = actionObject.url;
            var body = "";
            var formData = "";
            var query = "{ params: {";
            for (var p = 0; p < actionObject.parameters.length; p++) {
                var param = actionObject.parameters[p];
                if (parameters.length > 0) { parameters += ", ";}
                parameters += param.name + ": " + getCorrectParamType(param);
                if (param.in === "path") {
                    url = url.replace("{" + param.name + "}", "'+" + param.name + "+'");
                }
                if (param.in === "body") {
                    if (body.length > 1) { body += ", ";}
                    body += param.name;
                }
                if (param.in === "query") {
                    if (query.length > 11) { query += ", "; }
                    query += param.name;
                }
                if (param.in === "formData") {
                    if (formData.length > 1) { query += ", "; }
                    formData += "formData.append('" + param.name + "'," + param.name +");\r\n";
                }
            }
            body += "";
            query += "}}";
            var config = body.length > 2 ? body : query;

            var returnType = getCorrectParamType(actionObject.response);
            var headers = "";
            generatedCode += "\tpublic " + actionObject.actionName + " = async (" + parameters + "): Promise<" + returnType + "> => {\r\n";

            if (actionObject.contentType) {
                headers = "{" + "headers: {" + "'Content-Type': '" + actionObject.contentType + "'" + "}}";
                if (actionObject.contentType === "multipart/form-data") {
                    generatedCode += "\t\tlet formData = new FormData();\r\n";
                    generatedCode += "\t\t" + formData;
                    config = "formData";
                }
            }

            generatedCode += "\t\tconst result = await "+axiosInstanceName+"." + actionObject.type + "('" + url + "', " + config + ", " + headers+");\r\n";
            if (returnType === "void") {
                generatedCode += "\t\treturn Promise.resolve();\r\n";
            } else {
                generatedCode += "\t\treturn result.data as " + returnType+";\r\n";
            }
                    
            generatedCode += "\t} \r\n";
        }
        generatedCode += "} \r\n";
    }

    return generatedCode;
}

function getCorrectParamType(param) {
    var type = param.type;
    if (!param.type && !param.schema) {
        type = "void";
    }
    if (!type) {
        type = param.schema.type;
    }
    if (!type) {
        type = param.schema.$ref;
        if (type) {
            type = type.substring(type.lastIndexOf("/")+1);
        }
    }

    if (type === "file") { type = "File"; }
    if (type === "integer") { type = "number"; }
    type = type.replace("[", "<").replace("]", ">");

    if (type === "array") {
        type = param.schema.items.$ref;
        if (type) {
            type = type.substring(type.lastIndexOf("/") + 1);
        } else {
            type = param.items.type;
        }
        if (type) {
            type += "[]";
        } else {
            type = "object[]";
        }
    }
    return type;
}

