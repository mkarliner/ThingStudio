var checkFeed = function(feed) {
	if(typeof feed != "string" ) {
		Session.set("runtimeErrors", "Feedname needs to be a string");
		return;
	}
	f = Feeds.findOne({title: feed});
	console.log("CF: ", f)
	if(typeof f == "undefined") {
		Session.set("runtimeErrors", "Unknown feed " + feed);
	} 
}

compileTemplate = function(name, html_text) {
	try {
		Session.set("compilationErrors", "");
		Session.set("runtimeErrors", null);
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
				checkFeed(feed);
				return Messages.find({
					feed: feed
				});
			},
			message: function(feed){
				checkFeed(feed);
				msg = Messages.findOne({
					feed: feed
				});
				return msg ? msg.message : "-";
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
				ev.preventDefault();
				attr = ev.currentTarget.attributes;
				// console.log("TEMPLATE CLICK: ", this, attr);
				feed_name = attr.getNamedItem("data-feed");
				if(typeof feed_name == "undefined") {
					return;
				}
				message = attr.getNamedItem("data-message");
				// console.log("FN: ", feed_name.value, message.value)
				feed = Feeds.findOne({title: feed_name.value});
				console.log(feed);
				publish(feed.subscription, message ? message.value : "click");
			},
			'change input[type="checkbox"]': function(ev) {
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				value = attr.getNamedItem("checked");
				feed = Feeds.findOne({title: feed_name.value});
				publish(feed.subscription, ev.target.checked.toString());
				ev.stopImmediatePropagation();
			},
			'change input': function(ev) {
				console.log("INPUT CHANGED", this, ev);
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				console.log("FEEDNAME: ", feed_name)
				if(!feed_name) {
					Session.set("runtimeErrors", "Missing feed name");
					return;
				}
				value = $(ev.target).val();
				checkFeed(feed_name);
				feed = Feeds.findOne({title: feed_name.value});
				
				if(typeof feed == "undefined") {
					return;
				}
				// console.log(feed);
				publish(feed.subscription, value);
			},
			'input': function(ev) {
				// console.log("INPUT ", ev);
				attr = ev.currentTarget.attributes;
				feed_name = attr.getNamedItem("data-feed");
				if(attr.getNamedItem("data-continuous")) {
					value = $(ev.target).val();
					feed = Feeds.findOne({title: feed_name.value});
					publish(feed.subscription, value);
				}
				
			}
		});
		
		Template[name].rendered = function(){
			// console.log("RENDERED", this)
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
			update: function(err, res, template) {
				console.log("AFTER CON UPDATE: ", err, res, template);
				Session.set("ConnectionStatus", false);
				connect(template.data.doc);
				Router.go("/screens");
				
			}
		}
	}



});
