Template.EditScreenHeader.helpers({
	log: function() {
		console.log(this);
	},
	domain: function(){
		return Meteor.settings.public.domain;
	}
});

Template.EditScreenBody.events({
	'click #togglePreview': function(ev){
		$('#renderScreen').toggle();
		$('#editScreen').toggleClass('fullWidth');
	},
	'click #jstab': function(e, tmpl){
		//console.log("JSTAB")
		AceEditor.instance("archyjs").resize();
		// AceEditor.instance("archyjs").renderer.updateFull()
	},
});

Template.EditScreenBody.helpers({
	compilationErrors: function(){
		return Session.get("compilationErrors")
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	accessStatus: function(){
		if(this.owner != Meteor.userId()) {
			return "This template is read - only, you can make edits, but they will have no effect. "
		}
	},
	safeEdit: function(){
		return this.safeEdit;
	}
});

Meteor.startup(function(){
	AutoForm.addInputType('acecss', {
		template: 'afAceCss',
		valueOut: function(obj) {
			//console.log("OUT: ", AceEditor.instance("archycss").getValue())
			return AceEditor.instance("archycss").getValue();
		}
	});

	AutoForm.addInputType('acejs', {
		template: 'afAceJs',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archyjs").getValue())
			return AceEditor.instance("archyjs").getValue();
		}
	});

	AutoForm.addInputType('aceappjs', {
		template: 'afAceAppJs',
		valueOut: function(obj) {
			console.log("OUT: ", AceEditor.instance("archyappjs").getValue());
			return AceEditor.instance("archyappjs").getValue();
		}
	});

	AutoForm.addInputType('aceappcss', {
		template: 'afAceAppCSS',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archyappcss").getValue());
			return AceEditor.instance("archyappcss").getValue();
		}
	});

	AutoForm.addInputType('aceappdoc', {
		template: 'afAceAppDoc',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archyappdoc").getValue());
			return AceEditor.instance("archyappdoc").getValue();
		}
	});

	AutoForm.addInputType('ace', {
		template: 'afAce',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archy").getValue())
			return AceEditor.instance("archy").getValue();
		}
	});
})

Template.afAce.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj, this);
	},
	loadValue: function(editor){
		// console.log("Setting value ", this.value)
		// ace = AceEditor.instance("archy",{
		//     theme:"dawn",
		//     mode:"html"
		// });
		//  ace.setValue(this.value);

	}
});

Template.afAceCss.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj);
	},
	loadValue: function(editor){
		// console.log("Setting value ", this.value)
		// ace = AceEditor.instance("archy",{
		//     theme:"dawn",
		//     mode:"html"
		// });
		//  ace.setValue(this.value);

	}
});

Template.afAceJs.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj, this);
	},
	loadValue: function(editor){
	}
});

Template.afAceAppJs.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj, this);
	},
	loadValue: function(editor){
	}
});

Template.afAceJs.rendered = function() {
	var editor;
	console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyjs", {
			theme: "cobalt",
			mode: "javascript"
		});

		if(editor.loaded===true){
			e.stop();
			cs = Session.get("currentScreenPage");
			editor.$blockScrolling = Infinity;
			editor.setValue(Screens.findOne({_id: cs}).js, -1);
		}
	});
}

Template.afAceAppJs.rendered = function() {
	var editor;
	 console.log("APPJS RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyappjs", {
			theme: "cobalt",
			mode: "javascript"
		});

		if(editor.loaded===true){
			e.stop();
			currentApp = getCurrentApp();
			console.log("Editor Loaded!!!!!!")
			editor.$blockScrolling = Infinity;
			editor.setValue(Apps.findOne({_id: currentApp._id}).js, -1);
		}
	});
}

Template.afAceCss.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archycss", {
			theme: "cobalt",
			mode: "css"
		});

		if(editor.loaded===true){
			e.stop();
			editor.$blockScrolling = Infinity;
		}
	});
}

Template.afAceAppCSS.rendered = function() {
	var editor;
	 console.log("APPCSS RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyappcss", {
			theme: "cobalt",
			mode: "css"
		});

		if(editor.loaded===true){
			e.stop();
			currentApp = getCurrentApp();
			editor.$blockScrolling = Infinity;
			editor.setValue(Apps.findOne({_id: currentApp._id}).css, -1);
		}
	});
}

Template.afAceAppDoc.rendered = function() {
	var editor;
	 console.log("APPDOC RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyappdoc", {
			theme: "cobalt",
			mode: "markdown"
		});

		if(editor.loaded===true){
			e.stop();
			currentApp = getCurrentApp();
			editor.$blockScrolling = Infinity;
			editor.setValue(Apps.findOne({_id: currentApp._id}).documentation, -1);
		}
	});
}

Template.afAce.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {
		editor = AceEditor.instance("archy", {
			theme: "cobalt",
			mode: "handlebars"
		});
		if(editor.loaded===true){
			e.stop();
			cs = Session.get("currentScreenPage");
			editor.$blockScrolling = Infinity;
			editor.setValue(Screens.findOne({_id: cs}).html, -1);
		}
	});
}
