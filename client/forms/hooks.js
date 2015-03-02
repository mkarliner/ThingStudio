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
		Template[name].helpers({
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
			},
			feedmatch: function(feedname, match){
				feed = Feeds.findOne({title: feedname});
				// console.log("FEEDMATCH: ", feed, match);
				regex = mqttregex(feed.subscription).exec;
				params = regex(this.topic);
				// console.log(params);
				return params[match];
			}
		});
		Template[name].events({
			'click button': function(ev){
				attr = ev.currentTarget.attributes;
				// console.log("TEMPLATE CLICK: ", this, attr);
				feed_name = attr.getNamedItem("data-feed");
				message = attr.getNamedItem("data-message");
				// console.log("FN: ", feed_name.value, message.value)
				feed = Feeds.findOne({title: feed_name.value});
				console.log(feed);
				mqttClient.publish(feed.subscription, message ? message.value : "click");
			},
			'change input[type="checkbox"]': function(ev) {
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				value = attr.getNamedItem("checked");
				feed = Feeds.findOne({title: feed_name.value});
				mqttClient.publish(feed.subscription, ev.target.checked.toString());
				ev.stopImmediatePropagation();
			},
			'change input': function(ev) {
				console.log("INPUT CHANGED", this, ev);
				attr = ev.currentTarget.attributes;
				
				feed_name = attr.getNamedItem("data-feed");
				value = $(ev.target).val();

				feed = Feeds.findOne({title: feed_name.value});
				// console.log(feed);
				mqttClient.publish(feed.subscription, value);
			}
		});
		
		Template[name].rendered = function(){
			// console.log("RENDERED: ", this.findAll("[data-feed]"));
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
				scr = Session.get("currentScreenPage");
				name = Screens.findOne(scr).title;
				console.log("SCR: ", name)
				delete Template[name]; //Remove the existing template instance.
				//console.log("Updated Screen", template.data.doc.html);

				compileTemplate(name, template.data.doc.html);
				//
				// Session.set("currentScreenPage", "rubbish")
				// Session.set("currentScreenPage", 'faceplate')
			}
		}
	}



});
