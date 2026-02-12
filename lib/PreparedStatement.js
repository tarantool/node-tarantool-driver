/**
 * Represents a prepared SQL statement
 */
module.exports = class PreparedStatement {
    /**
     * Creates a prepared statement
     * @param {number} id - Statement ID from the server
     */
    constructor(id) {
        this.stmt_id = id;
    }
};
