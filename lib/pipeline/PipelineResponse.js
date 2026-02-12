const { TarantoolError } = require("../errors");

function findPipelineError (array) {
    const error = (array || this).find(element => element[0]);
    return error ? error[0] : null;
};

function findPipelineErrors (array) {
    const a = [];
    for (const subarray of (array || this)) {
        const errored_element = subarray[0]
        if (errored_element) a.push(errored_element)
    }

    return a;
};

class PipelineResponse extends Array {
    findPipelineError = findPipelineError;
    findPipelineErrors = findPipelineErrors;
    static findPipelineError = findPipelineError;
    static findPipelineErrors = findPipelineErrors;

    constructor (arr) {
        super(...arr);
    };

	get pipelineError () {
		return this.findPipelineError()
	};

	get pipelineErrors () {
		return this.findPipelineErrors()
	}
}
module.exports = PipelineResponse;