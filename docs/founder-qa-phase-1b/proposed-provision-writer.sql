-- REVIEW ONLY. Executed by the cluster role administrator.
-- Set a generated password out of band (psql \password or managed secret
-- provisioning) before giving the connection URL to the server.
create role flh_guest_writer login noinherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls connection limit 5;
