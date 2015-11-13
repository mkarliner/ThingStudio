Router.onBeforeAction(function () {

	//Get connection credentials if necessary

  // all properties available in the route function
  // are also available here such as this.params
	// console.log("Running connection beforeaction")
	app = getCurrentApp();
	if(Session.get("cmOperation") == "null") {
		Session.set("cmOperation", undefined);
		Session.set("cmCollection", undefined);
	}
	if(!app) {
		this.next();
		return;
	}
	// If this is not an MQTT app don't bother.
	if(!app.connection || app.connection == "none") {
		this.next();
		return;
	}
	if(!this.ready){
		this.next();
		return;
	}
	// Is there an existing connection?
	if(mqttClient.connected == true) {
		this.next();
		return;
	}
	connection = getCurrentConnection();
	if(!connection) {
		// No, we have to decide which connection to use.
		//Does this app have an active connection defined?
		if(app.connection) {
			connection = Connections.findOne({_id: app.connection});
			if(!connection) {
				disconnect();
				this.next();
				return;
			}
			setCurrentConnection(connection, "Before Action (common)" );
		} else {
			// No, just let them go on.
			disconnect();
			this.next();
			return;
		}
	}

	// console.log("VIEWCONN ", app.connection, connection);
	// Do I need to the user to provide authentication credentials?
	if ((!connection.serverCredentials || connection.serverCredentials == false) && Session.get("authReady") != true) {
		//console.log("NEED AUTH")
		if (!Ground.ready()) {
			console.log("GROUND NOT READY")
			this.render("Loading", {
				data: "Authentication database"
			});
			return;
		}
		console.log("GROUND  READY")
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
					username: "username",
					password: "password",
					save: false
				}
			});
			console.log("Creating credentials record")
			cred = Credentials.findOne({
				connection: connection._id
			})
		}

		this.render("GetMyCredentials", {
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
		//console.log("AUTH OK", connection)
		credentials = getCredentials();
		if(connection.serverCredentials) {
			connect(connection);   //server auth connection
		} else {
			connect(connection, credentials.username, credentials.password); //Client auth connection
		}

	}

	this.next();
});
