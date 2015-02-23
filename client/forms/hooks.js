compileTemplate = function(name, html_text) {
	try {
		Session.set("compilationErrors", "");
		var compiled = SpacebarsCompiler.compile(html_text, {
			isTemplate: true
		});
		var renderer = eval(compiled);
		// console.log('rendered:',renderer);
		Template.__checkName(name);
		Template[name] = new Template("Template." + name, renderer);
		//Template.__define__(name, renderer);
		Template['faceplate'].helpers({
			messages: function(feed) {
				return Messages.find({
					feed: feed
				});
			},
			message: function(feed){
				msg = Messages.findOne({
					feed: feed
				});
				return msg ? msg.message : "no data yet";
			}
		});
		Template['faceplate'].events({
			'click button': function(ev){
				attr = ev.currentTarget.attributes;
				console.log("TEMPLATE CLICK: ", this, attr);
				feed_name = attr.getNamedItem("data-feed");
				message = attr.getNamedItem("data-message");
				console.log("FN: ", feed_name.value, message.value)
				feed = Feeds.findOne({title: feed_name.value});
				console.log(feed);
				mqttClient.publish(feed.subscription, message ? message.value : "click");
			},
			'change input': function(ev) {
				attr = ev.currentTarget.attributes;
				console.log("TEMPLATE CHANGE: ", this, attr);
				feed_name = attr.getNamedItem("data-feed");
				value = $(ev.target).val();
				console.log("VALE", $(ev.target).val());			
				console.log("SEND: ", feed_name, value);
				feed = Feeds.findOne({title: feed_name.value});
				console.log(feed);
				mqttClient.publish(feed.subscription, value);
			}
		});
		
		Template['faceplate'].rendered = function(){
			console.log("RENDERED: ", this.findAll("[data-feed]"));
		}
	} catch (err) {
		console.log('Error compiling template:' + html_text);
		console.log(err.message);
		Session.set("compilationErrors", err.message);
	}
};



AutoForm.hooks({
	updateScreenForm: {
		before: {
			// update: function(docId, mod, template) {
			// 		console.log("Before update")
			// 		//doc.status = "Inactive";
			// 		return mod;
			// 	}
		},
		after: {
			update: function(err, res, template) {
				delete Template.faceplate; //Remove the existing template instance.
				//console.log("Updated Screen", template.data.doc.html);
				screen = Session.get("currentScreen");
				compileTemplate('faceplate', template.data.doc.html);

				Session.set("currentScreen", "rubbish")
				Session.set("currentScreen", 'faceplate')
			}
		}
	}



});
