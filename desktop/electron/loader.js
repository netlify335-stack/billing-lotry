'use strict';

/* Production entry: main process ka code V8 bytecode (main.jsc) se load hota
   hai taaki desktop shell ka source na dikhe. Dev mode mein plain .js chalta hai. */
if (process.env.CHANDRA_DEV === '1') {
    require('./src/main.js');
} else {
    require('bytenode');
    require('./main.jsc');
}
