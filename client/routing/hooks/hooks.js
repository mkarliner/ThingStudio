SetMQTTCredentials = function (that) {

	//Get connection credentials if necessary

  // all properties available in the route function
  // are also available here such as that.params
	// console.log("Running connection beforeaction")
	app = getCurrentApp();
	if(Session.get("cmOperation") == "null") {
		Session.set("cmOperation", undefined);
		Session.set("cmCollection", undefined);
	}
	if(!app) {
		that.next();
		return;
	}
	// If that is not an MQTT app don't bother.
	if(!app.connection || app.connection == "none") {
		that.next();
		return;
	}
	if(!that.ready){
		that.next();
		return;
	}
	// Is there an existing connection?
	if(mqttClient.connected == true) {
		that.next();
		return;
	}
	connection = getCurrentConnection();
	if(!connection) {
		// No, we have to decide which connection to use.
		//Does that app have an active connection defined?
		if(app.connection) {
			connection = Connections.findOne({_id: app.connection});
			if(!connection) {
				disconnect();
				that.next();
				return;
			}
			setCurrentConnection(connection, "Before Action (common)" );
		} else {
			// No, just let them go on.
			disconnect();
			that.next();
			return;
		}
	}

	// console.log("VIEWCONN ", app.connection, connection);
	// Do I need to the user to provide authentication credentials?
	if ((!connection.serverCredentials || connection.serverCredentials == false) && Session.get("authReady") != true) {
		//console.log("NEED AUTH")
		if (!Ground.ready()) {
			console.log("GROUND NOT READY")
			that.render("Loading", {
				data: "Authentication database"
			});
			return;
		}
		console.log("GROUND READY")
		cred = Credentials.findOne({
			connection: connection._id
		});
		if (cred) {
			console.log("FOUND CRED: ", cred)
		} else {
			cid = Credentials.upsert({
				connection: connection._id
			}, {
				$set: {
					connection: connection._id,
					host: connection.host,
					port: connection.port,
					protocol: connection.protocol,
					username: connection.username,
					password: "password",
					clientId: connection.clientId,
					save: false
				}
			});
			console.log("Creating credentials record")
			cred = Credentials.findOne({
				connection: connection._id
			})
		}

		that.render("GetMyCredentials", {
			data: function() {
				cred.connectionName = connection.title;
				cred.connectionHost = connection.host;
				console.log("CREDENTIALS: ", cred);
				return cred;
			}
		});
		return;
	} else {
		// We have displayed the form, and the user has clicked connect... now use the credentials she has entered.
		credentials = getCredentials();
		console.log("AUTH OK", connection, credentials)
		if(connection.serverCredentials) {
			connect(connection);   //server auth connection
		} else {
			connect(credentials, credentials.username, credentials.password); //Client auth connection
		}

	}

	that.next();
}
