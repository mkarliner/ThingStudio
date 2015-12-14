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
	safeEdit: function(){
		return this.safeEdit;
	}
});

Meteor.startup(function(){
	AutoForm.addInputType('acecss', {
		template: 'afAceCss',
		valueOut: function(obj) {
			return AceEditor.instance("archycss").getValue();
		}
	});

	AutoForm.addInputType('acejs', {
		template: 'afAceJs',
		valueOut: function(obj) {
			return AceEditor.instance("archyjs").getValue();
		}
	});

	AutoForm.addInputType('aceappjs', {
		template: 'afAceAppJs',
		valueOut: function(obj) {
			return AceEditor.instance("archyappjs").getValue();
		}
	});

	AutoForm.addInputType('aceappcss', {
		template: 'afAceAppCSS',
		valueOut: function(obj) {
			return AceEditor.instance("archyappcss").getValue();
		}
	});

	AutoForm.addInputType('aceappdoc', {
		template: 'afAceAppDoc',
		valueOut: function(obj) {
			return AceEditor.instance("archyappdoc").getValue();
		}
	});

	AutoForm.addInputType('ace', {
		template: 'afAce',
		valueOut: function(obj) {
			return AceEditor.instance("archy").getValue();
		}
	});
})

Template.afAce.helpers({
	debug: function(obj){
	},
	loadValue: function(editor){
	}
});

Template.afAceCss.helpers({
	debug: function(obj){
	},
	loadValue: function(editor){
	}
});

Template.afAceJs.helpers({
	debug: function(obj){
	},
	loadValue: function(editor){
	}
});

Template.afAceAppJs.helpers({
	debug: function(obj){
	},
	loadValue: function(editor){
	}
});

Template.afAceJs.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
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

	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyappjs", {
			theme: "cobalt",
			mode: "javascript"
		});

		if(editor.loaded===true){
			e.stop();
			currentApp = getCurrentApp();
			editor.$blockScrolling = Infinity;
			editor.setValue(Apps.findOne({_id: currentApp._id}).js, -1);
		}
	});
}

Template.afAceCss.rendered = function() {
	var editor;

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
