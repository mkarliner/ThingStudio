Template.gsChecklist.helpers({
	ok: function(item) {
		console.log("OK: ", item);
		switch(item) {
		case "connection":
			return Connections.find({}) ? "OK" : "Unfinished";
			break;
		case "feeds":
			return Feeds.find({}) ? "OK" : "Unfinished";
			break;
		case "screens":
			return Screens.find({}) ? "OK" : "Unfinished";
			break;
		case "themes":
			return Themes.find({}) ? "OK" : "Unfinished";
			break;
		}
	}
});

Template.gsChecklist.events({
	'click': function(ev, templ) {
		console.log("GSCLICK", ev.currentTarget.value, templ, this);
		Session.set("gsStep", ev.currentTarget.value);
	}
});


Template.gsEdit.helpers({
	editTemplate: function(){
		step = Session.get("gsStep");
		switch(step) {
		case "connection":
			conn = Connections.find({})
			return "insertConnectionForm";
			break;
		case "feeds":
			return "insertFeedForm";
			break;
		case "screens":
			return "insertScreenForm";
			break;
		case "themes":
			return "insertThemeForm";
			break;
		default: 
			return "UnkownForm";
			break;
		}
	}
	
});

Template.gsHelp.helpers({
	content: function(){
		step = Session.get("gsStep");
		console.log("GSSTEP ", step);
		switch(step) {
		case "connection":
			content =  HelpPages.findOne({urlstring: "basics-connection"}).body;
			console.log("CONTE ", content);
			return content;
			break;
		case "feeds":
			return HelpPages.findOne({urlstring: "basics-feeds"}).body;
			break;
		case "screens":
			return HelpPages.findOne({urlstring: "basics-screens"}).body;
			break;
		case "themes":
			return HelpPages.findOne({urlstring: "basics-themes"}).body;
			break;
		default: 
			return HelpPages.findOne({urlstring: "intro"}).body;
			break;
		}

	}
	
});