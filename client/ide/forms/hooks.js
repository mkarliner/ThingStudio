 checkFeed = function(feed, subscribe) {
	 // console.log("Check feed ", feed)
	if(typeof feed != "string" ) {
		// Session.set("runtimeErrors", "Feedname needs to be a string");
		var message = "Feedname needs to be a string: " + feed;
		Alerts.insert({type: 'runtime', status: 'warning', message: message});
		return false;
	}
	f = Feeds.findOne({title: feed});
	//console.log("CF: ", f)
	if(typeof f == "undefined") {
		// Session.set("runtimeErrors", "Unknown feed " + feed);
		var message = 'Unknown feed ' + feed;
		Alerts.insert({type: 'runtime', status: 'warning', message: message});
		return false;
	} 
	if(subscribe && f.pubsub == "Publish") {
		// Session.set("runtimeErrors", "Can't receive messages on publish feed: " + feed);
		var message = "Can't receive messages on publish feed " + feed;
		Alerts.insert({type: 'runtime', status: 'warning', message: message});
		return false;
	}
	
	return true;
}



compileTemplate = function(name, html_text, javascript) {
	try {
		Session.set("compilationErrors", '');
		Session.set("runtimeErrors", null);
		Session.set("alerts", {});
		var compiled = SpacebarsCompiler.compile(html_text, {
			isTemplate: true
		});
		var renderer = eval(compiled);
		// console.log('rendered:',renderer);
		Template.__checkName(name);
		Template[name] = new Template("Template." + name, renderer);
		//Template.__define__(name, renderer);
		Template[name].helpers({
			message: function(feed, defVal){
				if(typeof defVal == "number" || typeof defVal == "string") {
					defaultValue = defVal;
				} else {
					defaultValue = "-"
				}
				if(this.isWidget == false) {
					checkFeed(feed, true);
				}
				msg = Messages.findOne({
					feed: feed
				});
				return msg ? msg.payload : defaultValue;
			},
			feedmatch: function(match){
				feed = Feeds.findOne({title: this.feed});
				// console.log("FEEDMATCH: ", feed, match);
				regex = mqttregex(feed.subscription).exec;
				params = regex(this.topic);
				// console.log(params);
				return params[match];
			},
			journal: function(feed) {
				// console.log("JOURNAL: ", feed)
				msg = Messages.findOne({
					feed: feed
				});
				// console.log("MSG: ", msg);
				return msg && msg.journal ? msg.journal  : ["no values"];
			}
		});
		Template[name].events({
			'click button': function(ev){
				ev.preventDefault();
				attr = ev.currentTarget.attributes;
				// console.log("TEMPLATE CLICK: ", this, attr);
				feed_name = attr.getNamedItem("data-feed");
				console.log("FN: ", feed_name);
				if(!checkFeed(feed_name.value, false)){
					return;
				};
				message = attr.getNamedItem("data-message");
				// console.log("FN: ", feed_name.value, message.value)
				feed = Feeds.findOne({title: feed_name.value});
				console.log(feed);
				publish(feed, JSON.stringify(message ? message.value : "click"));
			},
			'change input[type="checkbox"]': function(ev) {
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				checkFeed(feed_name.value, false);
				value = attr.getNamedItem("checked");
				feed = Feeds.findOne({title: feed_name.value});
				publish(feed, JSON.stringify(ev.target.checked.toString()));
				ev.stopImmediatePropagation();
			},
			'change input': function(ev) {
				// console.log("INPUT CHANGED", this, ev);
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				checkFeed(feed_name.value, false);
				value = $(ev.target).val();
				checkFeed(feed_name.value, false);
				feed = Feeds.findOne({title: feed_name.value});
				
				if(typeof feed == "undefined") {
					return;
				}
				// console.log(feed);
				publish(feed, JSON.stringify(value));
			},
			'input': function(ev) {
				// console.log("INPUT ", ev);
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				checkFeed(feed_name.value, false);
				if(attr.getNamedItem("data-continuous")) {
					value = $(ev.target).val();
					feed = Feeds.findOne({title: feed_name.value});
					publish(feed, JSON.stringify(value));
				}
				
			}
		});

		if(javascript) {
			jsout = eval(javascript)
		}

		Template[name].rendered = function(){
			// console.log("RENDERED", this)
			// console.log("RENDERED: ", this.findAll("[data-feed]"));
		}
		return({type: 'template', status: 'success', message: 'Template updated'});
	} catch (err) {
		// console.log('Error compiling template:' + html_text);
		console.log('Error!', err);
		// console.log(err.message);
		// Session.set("compilationErrors", err.message)
		var errObj = {type: 'template', status: 'warning', message: err.message};
		Alerts.insert(errObj);
		return(errObj);
	}
};



AutoForm.hooks({
	updateScreenForm: {
		before: {
			update: function(mod){
				Alerts.remove({type: "template"});
				return mod;
				}
			},
		after: {
			update: function(res) {
				// console.log("ASU", this,  res)
				// //scr = Session.get("currentScreenPage");
				// myscreen = this.currentDoc;
				// name = myscreen.title;
				// // console.log("SCR: ", name, this)
				// template = this.template;
				// delete Template[name]; //Remove the existing template instance.
				// //console.log("Updated Screen", template.data.doc.html);
				// compret = compileTemplate(name, template.data.doc.html, template.data.doc.js);
				// Session.set("alerts", compret);
				// renderAlert(Session.get("alerts"));
				// Alerts.insert(compret);
				// if(template.data.doc.isWidget) {
				// 	try {
				// 		console.log("Registering widget")
				// 		Template[name].registerElement(template.data.doc.widgetName);
				// 	}
				// 	catch(err) {
				// 		console.log("Register Element: ", err);
				// 	}
				// }
				//
				// Session.set("currentScreenPage", "rubbish")
				// Session.set("currentScreenPage", 'faceplate')
			}
		}
	},
	updateFeedForm: {
		after: {
			insert: function(err, res, template) {
				console.log("AFTER FEED IN ", err, res, template);
			}
		}
	},
	updateConnectionForm: {
		after: {
			update: function(err, res) {
				console.log("AFTER CON UPDATE: ", err, res);
				Session.set("ConnectionStatus", false);
				Session.set("currentMQTTHost", this.template.data.doc.hostname)
				// connect(this.template.data.doc);
			}
		}
	},
	
	updateCredentialsForm: {
			onSubmit: function(a,b,c) {
				console.log("SUBMIT ", a, b, c)
			},
			before: {
				update: function(mod) {
					console.log("BEFORE CRED ", mod, mod.$set.username, mod.$set.password);
					setCredentials({username: mod.$set.username, password: mod.$set.password});
					if(mod.$set.save) {
						console.log("Saving credentials")
						return mod;
					} else {
						console.log("Not saving credentials")
						return false;
					}
					
				}
			},
			after: {
				update: function(err, res, temp) {
					console.log("AFTER CRED UPDATE: ", this, err, res, temp);
					// cred = Credentials.findOne({_id: this.docId});
					// setCredentials({username: cred.username, password: cred.password})
				}
			}
		},

		updateSettingsForm: {
			before: {
				update: function(err, res){
					console.log("BEFORE SETTINGS ", err, res, this )
				}
			},
			after: {
				update: function(err,res){
					console.log("AFTER SETTINGS ", this, err, res)
				}
			}
		},
		



});
