require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const isDocker = process.env.DOCKER_CONTAINER === "true";

function dbConfig() {
  return {
    username: process.env.DB_USER || "agregamigos",
    password: process.env.DB_PASSWORD || "initial123",
    database: process.env.DB_DATABASE || "agregamigos",
    host: isDocker ? "postgres" : process.env.DB_HOST || "127.0.0.1",
    port: isDocker ? 5432 : parseInt(process.env.DB_PORT || "5457", 10),
    dialect: process.env.DB_DIALECT || "postgres",
    logging: false,
  };
}

module.exports = {
  development: dbConfig(),
  stage: dbConfig(),
  production: dbConfig(),
  test: {
    dialect: "sqlite",
    storage: ":memory:",
    logging: false,
  },
};
