Template.WidgetsBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.WidgetList.created = function(){
		InstantiateWidgets();
}

Template.WidgetsHeader.events({
	'change input': function(e){
		console.log("WIN ", e.originalEvent.srcElement.files);
		file = e.originalEvent.srcElement.files[0];
		reader = new FileReader();
		reader.onload = function(thing) {
			console.log("TJING", thing);
			console.log("TSRC ", thing.srcElement.result)
			// return function(e) {thing.src = e.target.result};)(img)
		}
		reader.readAsText(file)
	}
})


Template.WidgetsBody.helpers({
	myWidgetList: function(){
		wl =  Widgets.find({  appId: {$ne: Meteor.settings.public.systemApp}})
		return wl;
	},
	systemWidgetList: function(){
		console.log("SWL System App Id", Meteor.settings.public.systemApp)
		wl =  Widgets.find({ appId: Meteor.settings.public.systemApp})
		return wl;
	}
});

Template.WidgetList.helpers({
	widgetTag: function(){
		console.log("WT: ", this.tagName)
		return "<"+this.tagName+">";
	},
	widgetEndTag: function(){
		return "</"+this.tagName+">";
	},
	owner: function() {
		return (this.owner == Meteor.userId())
	},
	isSystemWidget: function() {
		if ( this.appId == Meteor.settings.public.systemApp ) {
			return true;
		} else {
			return false;
		}
	}
});

Template.WidgetsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		$('.add-new-item select').material_select();
	}
});

Template.WidgetsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

