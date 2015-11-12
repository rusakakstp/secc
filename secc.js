#!/usr/bin/nodejs
console.time('SECC')

var path = require('path');
var argv = process.argv;

var nodePath = argv.shift();    //node path. /usr/bin/nodejs or /usr/bin/node
var commandPath = argv.shift(); //command. ./nodejs.js or ./bin/gcc
var command = path.basename(commandPath);
var originalArgv = argv.slice();  //for passThrough
var compilerPath = path.join('/','usr','bin',command);

if (['c++', 'cc', 'clang', 'g++', 'gcc'].indexOf(command) === -1) {
  console.log('print how-to');
  return;
}

var debug = require('debug')('secc:client');  // 4~5ms
debug('--- SECC START ---');

// check the policy. 
var passThrough = function(command, argv) {
  var os = require('os');
  //FIXME : check by freemem(512MB) ?
  var isSystemStable = function(criteria) {
    return (os.freemem() > (criteria || 1024*1024*512)) ? true : false;
  };
  var passThroughCompile = function(command, argv) {
    debug('passThrough');
    var spawn = require('child_process').spawn,
        exec = spawn(command, argv, {stdio: 'inherit'});
  };

 //check memory usages to prevent full load.
  if(isSystemStable())
    return passThroughCompile(command, argv);
  else {
    return setTimeout(function(){
      if(isSystemStable())
        return passThroughCompile(command, argv);
      else
        debug('wait... free memory is low.')
        return setTimeout(arguments.callee, 5000);
    }, 5000);
  }
};

if ( process.env.SECC_USELOCAL == 1  //always use local compiler.
  || argv.indexOf('-c') === -1   //when -c not exists
  || argv.indexOf('-M') !== -1   //when -M exists
  || argv.indexOf('-E') !== -1   //when -E exists
  || process.cwd().indexOf('CMakeFiles') !== -1 //always passThrough in CMakeFiles
  ) {
  return passThrough(compilerPath, originalArgv);
}


var async = require('async');
var SECC = require('./settings.json');
var compile = require('./lib/compile.js');
var environment = require('./lib/environment.js');

debug('loaded libraries.');

//define a job.
var JOB = {
  id : null,
  mode : (process.env.SECC_MODE == 2) ? '2' : '1',
  sourcePath : null,
  outputPath : null,
  declaredOutputPath : compile.determineOutputPath(argv,true),
  declaredSourcePath : compile.determineSourcePath(argv,false),
  projectId : compile.determineProjcetId(),
  cachePrefered : process.env.SECC_CACHE
                  ? ((process.env.SECC_CACHE == 1) ? true : false)
                  : SECC.client.cache,
  command : command,
  compilerPath : compilerPath,
  argv : argv,
  compilerInformation : null,
  compileFile : null
};

debug('projectId : %s , SourcePath : %s , OutputPath : %s, cachePrefered : %s'
  , JOB.projectId, JOB.declaredSourcePath, JOB.declaredOutputPath, JOB.cachePrefered);

async.waterfall([
  //check which compiler is using.
  function(callback) {
    environment.getCompilerInformation(JOB.compilerPath, function(err, compilerInformation) {
      if (err) return callback(err);

      delete compilerInformation.stats;
      JOB.compilerInformation = compilerInformation;
      debug('compiler information - %s... %s %s'
        , compilerInformation.version.substr(0,30)
        , compilerInformation.dumpversion
        , compilerInformation.dumpmachine);

      callback(null);
    })
  },

  //get right outputPath, sourcePath.
  function(callback) {
    var options = {compiler: JOB.compilerPath, argv: JOB.argv};

    compile.GetDependencies(options).on('finish', function(err, compileFile) {
      if (err) {
        debug('GetDependencies Error Raised.');
        debug(options);
        return callback(err);  //GetDependencies error.
      }

      debug('GetDependencies done. compileFile is....')
      debug('source : %s, object : %s, dependencies total : %d'
        ,compileFile.sourceFile, compileFile.objectFile, compileFile.dependencies.length);

      //FIXME : arrange right outputPath and sourcePath. 
      JOB.compileFile = compileFile;
      JOB.outputPath = JOB.declaredOutputPath || compileFile.objectFile;
      JOB.sourcePath = JOB.declaredSourcePath || compileFile.sourceFile;
      debug('arranged sourcePath %s , outputPath %s', JOB.sourcePath, JOB.outputPath);

      callback(null);
    });
  },

  //mode
  function(callback) {
    if(JOB.mode == '2') { //performPumpMode
      var client = require('./lib/clientPump.js');
      client.performPumpMode(JOB, SECC, function(err){
        if (err)
          return callback(err);

        callback(null);
      });
    } else { // performPreprocessedMode(default)
      var client = require('./lib/clientPreprocessed.js');
      client.performPreprocessedMode(JOB, SECC, function(err){
        if (err)
          return callback(err);

        callback(null);
      });
    }
  }
  ],

  //finally
  function(err) {
    if(err) {
      debug(err);
      return passThrough(compilerPath, originalArgv);
    }

    //Everything is okay.
    debug(process.memoryUsage());
    debug('--- SECC END ---');
    if (process.env.DEBUG) console.timeEnd('SECC')
  }
);