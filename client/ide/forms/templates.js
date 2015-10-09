Template.insertScreenForm.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.updateScreenForm.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.updateScreenForm.events({
	'click .close': function(e, tmpl) {
		tmpl.find(".alert").remove();
		Alerts.remove(this._id);
	},
	'click #jstab': function(e, tmpl){
		// console.log("JSTAB")
		AceEditor.instance("archyjs").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},
	'click .clear-alerts': function(e, tmpl) {
		Alerts.remove({});
	}
});

Template.updateScreenForm.helpers({
	// currentScreen: function() {
	// 	scr =  Session.get("currentScreenPage");
	// 	scn = Screens.findOne(scr);
	// 	//console.log("HTML: ", scn);
	// 	if(scn) {
	// 		//console.log("HTML: ", scn.html);
	// 		delete Template[scn.title];
	// 		compileTemplate(scn.title, scn.html, scn.js);
	// 		return scn.title;
	// 	} else {
	// 		return "NoScreen";
	// 	}
	// },
	alerts: function() {
		return Alerts.find();
	},
	alertType: function() {
		if (this.type === 'template' && this.status === 'success') {
			return 'Success:';
		} else if (this.type === 'template') {
			return 'Template Error:';
		} else if (this.type === 'runtime') {
			return 'Runtime Error:';
		} else {
			console.log('alertType else case firing')
		}
	},
	widgetDoc: function() {
		return Widgets.findOne({baseScreen: this._id});
	},
	alertCount: function() {
		return Alerts.find().count();
	}
});
