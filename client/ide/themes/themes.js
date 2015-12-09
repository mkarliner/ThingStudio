// Template.ThemesHeader.events({
// 	"click .header-action-1": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });
//
// Template.ThemesNewItem.events({
// 	"click .table-cancel-new": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	},
// 	"click .divider-decoration": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });
//
// Template.ThemesBody.helpers({
// 	themelist: function(){
// 		return Themes.find({})
// 	},
// 	status: function(){
// 		if(this.owner == Meteor.userId()) {
// 			return "Owner";
// 		} else if(this.public == true) {
// 			return("Public read-only")
// 		} else {
// 			return "Shouldn't happen"
// 		}
// 	}
// });
